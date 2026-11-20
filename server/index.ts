import express, { type ErrorRequestHandler, type Request, type RequestHandler, type Response } from 'express'
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hash, verify } from '@node-rs/argon2'

const scrypt = promisify(scryptCallback)
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (existsSync(resolve(rootDir, '.env'))) process.loadEnvFile(resolve(rootDir, '.env'))

const app = express()
const port = Number(process.env.PORT || 3000)
const isProduction = process.env.NODE_ENV === 'production' || dirname(fileURLToPath(import.meta.url)).endsWith('dist-server')
const dataDir = resolve(rootDir, process.env.STURRL_DATA_DIR || 'data')
const dataFile = resolve(dataDir, 'problems.json')
const configuredPepper = process.env.ANSWER_PEPPER
const answerPepper = configuredPepper ?? 'sturrl-development-only-change-this-before-deploying'
const subjects = ['국어', '영어', '수학', '사회', '과학', '한국사', '기타']
const grades = ['중1', '중2', '중3', '고1', '고2', '고3', '대학생', '기타']
const difficulties = [1, 2, 3, 4, 5]
const argon2Options = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const
const masterPasswordHash = process.env.MASTER_PASSWORD_HASH?.trim()

type Problem = {
  id: string
  title: string
  description: string
  subject: string
  grade: string
  difficulty: number
  author: string
  createdAt: string
  updatedAt?: string
  editVersion?: number
  views: number
  solvedBy: string[]
  correctSubmissions: number
  attempts?: number
  answerSalt: string
  answerVerifier: string
  managementPasswordHash?: string
  photos?: string[]
  ratings?: Record<string, number>
  explanation: { iv: string; tag: string; ciphertext: string }
}

let problems: Problem[] = []
let writeQueue: Promise<unknown> = Promise.resolve()
class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

app.disable('x-powered-by')
if (process.env.TRUST_PROXY_HOPS) {
  const hops = Number(process.env.TRUST_PROXY_HOPS)
  if (!Number.isSafeInteger(hops) || hops < 1) throw new Error('TRUST_PROXY_HOPS must be a positive integer.')
  app.set('trust proxy', hops)
}
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  })
  if (isProduction) {
    res.set('Content-Security-Policy', "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:")
  }
  next()
})

app.use('/server', (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    if (req.get('Sec-Fetch-Site') === 'cross-site') return next(new ApiError(403, '이 페이지에서 다시 요청해 주세요.'))
    if (!req.is('application/json')) return next(new ApiError(415, 'JSON 형식으로 요청해 주세요.'))
  }
  next()
})
const smallJson = express.json({ limit: '8kb' })
const problemJson = express.json({ limit: '25mb' })

function rateLimit(limit: number, minutes: number, message: string): RequestHandler {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  const window = minutes * 60_000
  let sweepAt = 0

  return (req, res, next) => {
    const now = Date.now()
    if (now >= sweepAt) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
      sweepAt = now + 60_000
    }
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown'
    const current = buckets.get(key)
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + window })
    } else if (current.count >= limit) {
      res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)))
      return next(new ApiError(429, message))
    } else {
      current.count += 1
    }
    next()
  }
}

const limitAnswer = rateLimit(12, 5, '정답 제출 횟수가 너무 많아요. 잠시 후 다시 시도해 주세요.')
const limitManagement = rateLimit(8, 15, '관리 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.')
const limitCreate = rateLimit(8, 15, '문제 등록 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.')
const limitReview = rateLimit(20, 5, '리뷰 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.')

const visitorCookie = 'sturrl_visitor'
const visitorPattern = /^[a-f0-9]{36}$/
function signVisitor(id: string) {
  return createHmac('sha256', answerPepper).update('sturrl-visitor-v1:').update(id).digest()
}

function visitorFrom(req: Request, allowLegacy = false) {
  const prefix = visitorCookie + '='
  const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))
  const [id, signature, extra] = cookie?.slice(prefix.length).split('.') ?? []
  if (!id || !visitorPattern.test(id) || extra !== undefined) return undefined
  if (signature === undefined) return allowLegacy ? id : undefined
  if (/^[a-f0-9]{64}$/.test(signature) && timingSafeEqual(signVisitor(id), Buffer.from(signature, 'hex'))) return id
  return undefined
}

function setVisitor(req: Request, res: Response, id: string) {
  const token = id + '.' + signVisitor(id).toString('hex')
  res.cookie(visitorCookie, token, { httpOnly: true, sameSite: 'lax', secure: req.secure || isProduction, path: '/', maxAge: 31_536_000_000 })
}

function viewerFor(problem: Problem, visitor?: string) {
  return { solved: !!visitor && problem.solvedBy.includes(visitor), rating: visitor ? problem.ratings?.[visitor] ?? null : null }
}

async function deriveKeys(answer: string, salt: Buffer) {
  return await scrypt(answer.normalize('NFKC').trim().toLocaleLowerCase('ko-KR') + ':' + answerPepper, salt, 64) as Buffer
}

function publicProblem(problem: Problem, includePhotos = false) {
  const ratings = Object.values(problem.ratings ?? {})
  return {
    id: problem.id, title: problem.title, description: problem.description, subject: problem.subject,
    grade: problem.grade, difficulty: problem.difficulty, author: problem.author, createdAt: problem.createdAt,
    updatedAt: problem.updatedAt, views: problem.views, solvedCount: problem.solvedBy.length,
    correctSubmissions: problem.correctSubmissions, attempts: problem.attempts ?? problem.correctSubmissions,
    photoCount: problem.photos?.length ?? 0, ...(includePhotos ? { photos: problem.photos ?? [] } : {}),
    reviewCount: ratings.length,
    averageRating: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null,
  }
}

async function save(next: Problem[]) {
  const temporary = dataFile + '.' + randomBytes(8).toString('hex') + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify({ problems: next }, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx', flush: true })
    await rename(temporary, dataFile)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

function commit<T>(change: (current: Problem[]) => { next: Problem[]; result: T }): Promise<T> {
  const operation = writeQueue.then(async () => {
    const { next, result } = change(problems)
    if (next !== problems) {
      await save(next)
      problems = next
    }
    return result
  })
  writeQueue = operation.catch(() => {})
  return operation
}

function findProblem(id: string | string[], items = problems) {
  const problem = items.find((item) => item.id === id)
  if (!problem) throw new ApiError(404, '문제를 찾을 수 없어요.')
  return problem
}

function updateProblem<T extends Problem | null>(id: string | string[], change: (current: Problem) => T) {
  return commit((items) => {
    const current = findProblem(id, items)
    const result = change(current)
    const next = result === current ? items : result
      ? items.map((item) => item === current ? result : item)
      : items.filter((item) => item !== current)
    return { next, result }
  })
}

function ensureSameVersion(initial: Problem, current: Problem) {
  if (initial.answerSalt !== current.answerSalt || initial.editVersion !== current.editVersion) {
    throw new ApiError(409, '문제가 수정됐어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.')
  }
}

function validPhoto(photo: unknown): photo is string {
  if (typeof photo !== 'string' || photo.length > 4_200_000) return false
  const header = /^data:image\/(jpeg|png|webp);base64,/.exec(photo)
  if (!header) return false
  const encoded = photo.slice(header[0].length)
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false
  const bytes = Buffer.from(encoded.slice(0, 16), 'base64')
  if (header[1] === 'jpeg') return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  if (header[1] === 'png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
}

function problemFields(body: unknown) {
  const fields = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  const { title, description, subject, grade, difficulty, author, answer, explanation, photos } = fields
  const level = typeof difficulty === 'number' || typeof difficulty === 'string' ? Number(difficulty) : NaN
  let solution: { answer: string; explanation: string } | undefined
  if (answer !== undefined || explanation !== undefined) {
    if (typeof answer !== 'string' || !answer.trim() || answer.trim().length > 200 ||
      typeof explanation !== 'string' || explanation.trim().length > 10000) {
      throw new ApiError(400, '문제의 정답과 해설을 확인해 주세요.')
    }
    solution = { answer: answer.trim(), explanation }
  }
  if (
    typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 120 ||
    typeof description !== 'string' || description.trim().length > 5000 ||
    typeof subject !== 'string' || !subjects.includes(subject) || typeof grade !== 'string' || !grades.includes(grade) ||
    !difficulties.includes(level) || typeof author !== 'string' || !author.trim() || author.trim().length > 30 ||
    (photos !== undefined && (!Array.isArray(photos) || photos.length > 5 || !photos.every(validPhoto)))
  ) throw new ApiError(400, '문제 정보, 정답과 첨부 사진을 확인해 주세요.')
  return { fields: { title: title.trim(), description: description.trim(), subject, grade, difficulty: level, author: author.trim(), photos }, solution }
}

async function buildAnswerMaterial(answer: string, explanation: string) {
  const salt = randomBytes(16)
  const keys = await deriveKeys(answer, salt)
  const verifier = createHmac('sha256', keys.subarray(32)).update('sturrl-answer-verifier-v1').digest('base64')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keys.subarray(0, 32), iv)
  const ciphertext = Buffer.concat([cipher.update(explanation, 'utf8'), cipher.final()])
  return {
    answerSalt: salt.toString('base64'),
    answerVerifier: verifier,
    explanation: { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') },
  }
}

app.get('/server/health', (_req, res) => {
  res.json({ ok: true, service: 'sturrl-api', timestamp: new Date().toISOString() })
})

app.get('/server/problems', (req, res) => {
  const { subject, grade, difficulty, sort = 'newest', q = '' } = req.query
  const toFilterList = (value: unknown) => (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
  const subjectFilters = toFilterList(subject)
  const gradeFilters = toFilterList(grade)
  const difficultyFilters = toFilterList(difficulty).map(Number).filter((item) => difficulties.includes(item))
  const query = typeof q === 'string' ? q.trim().slice(0, 120).toLocaleLowerCase('ko-KR') : ''
  const items = problems.filter((problem) =>
    (!subjectFilters.length || subjectFilters.includes(problem.subject)) &&
    (!gradeFilters.length || gradeFilters.includes(problem.grade)) &&
    (!difficultyFilters.length || difficultyFilters.includes(problem.difficulty)) &&
    (!query || (problem.title + ' ' + problem.description + ' ' + problem.author).toLocaleLowerCase('ko-KR').includes(query)),
  )
  items.sort((a, b) => {
    if (sort === 'views') return b.views - a.views
    if (sort === 'solved') return b.solvedBy.length - a.solvedBy.length
    if (sort === 'correct') return b.correctSubmissions - a.correctSubmissions
    if (sort === 'difficulty') return b.difficulty - a.difficulty
    return b.createdAt.localeCompare(a.createdAt)
  })
  const correctSubmissions = problems.reduce((sum, problem) => sum + problem.correctSubmissions, 0)
  res.json({ items: items.map((problem) => publicProblem(problem)), total: items.length, stats: { problemCount: problems.length, correctSubmissions } })
})

app.post('/server/problems', limitCreate, problemJson, async (req, res) => {
  const { fields, solution } = problemFields(req.body)
  const password: unknown = req.body?.managementPassword
  if (typeof password !== 'string' || password.trim().length < 8 || password.length > 256) {
    throw new ApiError(400, '관리 암호를 8자 이상 입력해 주세요.')
  }
  if (!solution) throw new ApiError(400, '문제의 정답을 입력해 주세요.')
  const material = await buildAnswerMaterial(solution.answer, solution.explanation)
  const managementPasswordHash = await hash(password, argon2Options)
  const problem: Problem = {
    ...fields, ...material, managementPasswordHash, id: randomBytes(12).toString('hex'),
    createdAt: new Date().toISOString(), views: 0, solvedBy: [], attempts: 0, correctSubmissions: 0,
  }
  await commit((items) => ({ next: [problem, ...items], result: undefined }))
  res.status(201).json({ item: publicProblem(problem, true) })
})

app.get('/server/problems/:id', async (req, res) => {
  const problem = await updateProblem(req.params.id, (current) => ({ ...current, views: current.views + 1 }))
  res.json({ item: publicProblem(problem, true), viewer: viewerFor(problem, visitorFrom(req)) })
})

app.post('/server/problems/:id/answer', limitAnswer, smallJson, async (req, res) => {
  const initial = findProblem(req.params.id)
  const answer: unknown = req.body?.answer
  if (typeof answer !== 'string' || !answer.trim() || answer.trim().length > 200) throw new ApiError(400, '정답을 입력해 주세요.')
  const keys = await deriveKeys(answer, Buffer.from(initial.answerSalt, 'base64'))
  const candidate = createHmac('sha256', keys.subarray(32)).update('sturrl-answer-verifier-v1').digest()
  const expected = Buffer.from(initial.answerVerifier, 'base64')
  const correct = candidate.length === expected.length && timingSafeEqual(candidate, expected)
  const knownVisitor = visitorFrom(req)
  const legacyVisitor = visitorFrom(req, true)
  const visitor = correct ? knownVisitor ?? legacyVisitor ?? randomBytes(18).toString('hex') : undefined
  let explanation: string | undefined
  if (correct) {
    const encrypted = initial.explanation
    const decipher = createDecipheriv('aes-256-gcm', keys.subarray(0, 32), Buffer.from(encrypted.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'))
    explanation = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'base64')), decipher.final()]).toString('utf8')
  }
  const problem = await updateProblem(req.params.id, (current) => {
    ensureSameVersion(initial, current)
    const attempts = (current.attempts ?? current.correctSubmissions) + 1
    if (!correct || !visitor) return { ...current, attempts }
    const solvedBy = current.solvedBy.includes(visitor) ? current.solvedBy : [...current.solvedBy, visitor]
    return { ...current, attempts, solvedBy, correctSubmissions: current.correctSubmissions + 1 }
  })
  if (correct && visitor && !knownVisitor) setVisitor(req, res, visitor)
  res.json({
    correct, explanation, attempts: problem.attempts, solvedCount: problem.solvedBy.length,
    correctSubmissions: problem.correctSubmissions,
    ...(correct ? { viewer: viewerFor(problem, visitor) } : { error: '정답이 아니에요. 다시 생각해 보세요.' }),
  })
})

app.put('/server/problems/:id/review', limitReview, smallJson, async (req, res) => {
  const rating: unknown = req.body?.rating
  if (rating !== null && (typeof rating !== 'number' || !difficulties.includes(rating))) {
    throw new ApiError(400, '1점부터 5점까지 별점을 선택해 주세요.')
  }
  const visitor = visitorFrom(req)
  if (!visitor) throw new ApiError(403, '문제를 푼 뒤 별점을 남길 수 있어요.')
  const problem = await updateProblem(req.params.id, (current) => {
    if (!current.solvedBy.includes(visitor)) throw new ApiError(403, '문제를 푼 뒤 별점을 남길 수 있어요.')
    if ((current.ratings?.[visitor] ?? null) === rating) return current
    const ratings = { ...current.ratings }
    if (rating === null) delete ratings[visitor]
    else ratings[visitor] = rating
    return { ...current, ratings }
  })
  const { reviewCount, averageRating } = publicProblem(problem)
  res.json({ reviewCount, averageRating, viewer: viewerFor(problem, visitor) })
})

async function authorizeManagement(problem: Problem, password: unknown) {
  if (typeof password !== 'string' || !password.length || password.length > 256) return false
  for (const digest of [problem.managementPasswordHash, masterPasswordHash]) {
    if (digest && await verify(digest, password).catch(() => false)) return true
  }
  return false
}

app.put('/server/problems/:id', limitManagement, problemJson, async (req, res) => {
  const initial = findProblem(req.params.id)
  if (!await authorizeManagement(initial, req.body?.managementPassword)) throw new ApiError(403, '관리 암호가 올바르지 않아요.')
  const { fields, solution } = problemFields(req.body)
  const material = solution ? await buildAnswerMaterial(solution.answer, solution.explanation) : undefined
  const problem = await updateProblem(req.params.id, (current) => {
    ensureSameVersion(initial, current)
    return {
      ...current, ...fields, ...material, photos: fields.photos ?? current.photos,
      updatedAt: new Date().toISOString(), editVersion: (current.editVersion ?? 0) + 1,
    }
  })
  res.json({ item: publicProblem(problem, true), viewer: viewerFor(problem, visitorFrom(req)) })
})

app.delete('/server/problems/:id', limitManagement, smallJson, async (req, res) => {
  const initial = findProblem(req.params.id)
  if (!await authorizeManagement(initial, req.body?.managementPassword)) throw new ApiError(403, '관리 암호가 올바르지 않아요.')
  await updateProblem(req.params.id, (current) => {
    ensureSameVersion(initial, current)
    return null
  })
  res.status(204).end()
})

app.use('/server', (_req, _res, next) => next(new ApiError(404, '요청한 주소를 찾을 수 없어요.')))
const apiErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error)
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message })
  } else if (error?.status === 413) {
    res.status(413).json({ error: '첨부 파일 용량을 줄인 뒤 다시 시도해 주세요.' })
  } else if (error?.status === 400 || error?.status === 415) {
    res.status(error.status).json({ error: '요청 형식을 확인해 주세요.' })
  } else {
    console.error('[Sturrl] Request failed:', error instanceof Error ? error.message : 'Unknown error')
    res.status(500).json({ error: '서버에서 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' })
  }
}
app.use('/server', apiErrorHandler)

async function start() {
  if (isProduction && !configuredPepper?.trim()) throw new Error('Set ANSWER_PEPPER before starting Sturrl in production.')
  await mkdir(dataDir, { recursive: true })
  try {
    const parsed: unknown = JSON.parse(await readFile(dataFile, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || !('problems' in parsed) || !Array.isArray(parsed.problems)) {
      throw new Error('Invalid problem data. Restore problems.json before starting Sturrl.')
    }
    problems = parsed.problems.filter((item): item is Problem => !!item && typeof item.id === 'string')
      .map((problem) => ({
        ...problem, solvedBy: Array.isArray(problem.solvedBy) ? problem.solvedBy : [],
        views: Number.isFinite(problem.views) ? problem.views : 0,
        correctSubmissions: Number.isFinite(problem.correctSubmissions) ? problem.correctSubmissions : 0,
      }))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await save([])
  }
  if (configuredPepper === undefined) console.warn('[Sturrl] ANSWER_PEPPER is not set. Using the development fallback.')
  if (isProduction) {
    const clientDir = resolve(rootDir, 'dist')
    app.use(express.static(clientDir))
    app.get(/.*/, (_req, res) => res.sendFile(resolve(clientDir, 'index.html')))
  } else {
    const { createServer } = await import('vite')
    const vite = await createServer({
      configFile: resolve(rootDir, 'vite.config.ts'), root: rootDir, appType: 'spa',
      server: { middlewareMode: true, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**', dataDir.replaceAll('\\', '/') + '/**'] } },
    })
    app.use(vite.middlewares)
  }
  app.listen(port, process.env.STURRL_HOST || '0.0.0.0', () => {
    console.log('[Sturrl] Server ready at http://localhost:' + port)
  })
}
start().catch((error: unknown) => { console.error('[Sturrl] Failed to start:', error); process.exit(1) })
