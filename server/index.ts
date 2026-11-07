import express, { type Request, type Response } from 'express'
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import { hash, verify } from '@node-rs/argon2'

const scrypt = promisify(scryptCallback)
const app = express()
const port = Number(process.env.PORT ?? 3000)
const isProduction = process.env.NODE_ENV === 'production' || dirname(fileURLToPath(import.meta.url)).endsWith('dist-server')
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = resolve(rootDir, 'data')
const dataFile = resolve(dataDir, 'problems.json')
const answerPepper = process.env.ANSWER_PEPPER ?? 'sturrl-development-only-change-this-before-deploying'
const subjects = ['국어', '영어', '수학', '사회', '과학', '한국사']
const grades = ['중1', '중2', '중3', '고1', '고2', '고3', '대학생']
const difficulties = [1, 2, 3, 4, 5]
const argon2Options = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const

type Problem = {
  id: string
  title: string
  description: string
  subject: string
  grade: string
  difficulty: number
  author: string
  createdAt: string
  views: number
  solvedBy: string[]
  correctSubmissions: number
  answerSalt: string
  answerVerifier: string
  managementPasswordHash?: string
  photos?: string[]
  explanation: { iv: string; tag: string; ciphertext: string }
}
type Store = { problems: Problem[] }
let store: Store = { problems: [] }
let writeQueue = Promise.resolve()
const attempts = new Map<string, { count: number; resetAt: number }>()

app.disable('x-powered-by')
app.use(express.json({ limit: '25mb' }))

function getVisitorId(req: Request, res: Response) {
  const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('sturrl_visitor='))
  const existing = cookie?.slice('sturrl_visitor='.length)
  if (existing && /^[a-f0-9]{36}$/i.test(existing)) return existing
  const id = randomBytes(18).toString('hex')
  res.setHeader('Set-Cookie', `sturrl_visitor=${id}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${isProduction ? '; Secure' : ''}`)
  return id
}

function limitAttempts(req: Request, res: Response) {
  const key = req.ip ?? req.socket.remoteAddress ?? 'unknown'
  const now = Date.now()
  const current = attempts.get(key)
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 5 * 60 * 1000 })
    return false
  }
  if (current.count >= 12) {
    res.status(429).json({ error: '정답 제출 횟수가 너무 많습니다. 5분 후 다시 시도해 주세요.' })
    return true
  }
  current.count += 1
  return false
}

async function deriveKeys(answer: string, salt: Buffer) {
  return await scrypt(`${answer.normalize('NFKC').trim().toLocaleLowerCase('ko-KR')}:${answerPepper}`, salt, 64) as Buffer
}

function publicProblem(problem: Problem, includePhotos = false) {
  const { answerSalt: _salt, answerVerifier: _verifier, managementPasswordHash: _managementHash, explanation: _explanation, solvedBy, photos, ...safe } = problem
  return { ...safe, ...(includePhotos && photos ? { photos } : {}), solvedCount: Array.isArray(solvedBy) ? solvedBy.length : 0 }
}

async function persist() {
  writeQueue = writeQueue.then(() => writeFile(dataFile, JSON.stringify(store, null, 2), 'utf8'))
  await writeQueue
}

function validPhotos(value: unknown) {
  if (value === undefined) return true
  return Array.isArray(value) && value.length <= 5 && value.every((photo) =>
    typeof photo === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(photo) && photo.length <= 4_200_000,
  )
}

function validProblemFields(body: any) {
  const { title, description, subject, grade, difficulty, author, answer, explanation } = body ?? {}
  return typeof title === 'string' && title.trim().length >= 3 && title.trim().length <= 120 &&
    typeof description === 'string' && description.trim().length >= 5 && description.trim().length <= 5000 &&
    subjects.includes(subject) && grades.includes(grade) && difficulties.includes(Number(difficulty)) &&
    typeof author === 'string' && author.trim().length > 0 && author.trim().length <= 30 &&
    typeof answer === 'string' && answer.trim().length > 0 && answer.trim().length <= 200 &&
    typeof explanation === 'string' && explanation.trim().length > 0 && explanation.trim().length <= 10000 && validPhotos(body?.photos)
}

async function buildAnswerMaterial(answer: string, explanation: string) {
  const answerSalt = randomBytes(16)
  const keys = await deriveKeys(answer, answerSalt)
  const answerVerifier = createHmac('sha256', keys.subarray(32)).update('sturrl-answer-verifier-v1').digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keys.subarray(0, 32), iv)
  const ciphertext = Buffer.concat([cipher.update(explanation, 'utf8'), cipher.final()])
  return {
    answerSalt: answerSalt.toString('base64'),
    answerVerifier: answerVerifier.toString('base64'),
    explanation: { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') },
  }
}

app.get('/server/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'sturrl-api', timestamp: new Date().toISOString() })
})

app.get('/server/problems', (req: Request, res: Response) => {
  const { subject, grade, difficulty, sort = 'newest', q = '' } = req.query
  const toFilterList = (value: unknown) => (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
  const subjectFilters = toFilterList(subject)
  const gradeFilters = toFilterList(grade)
  const difficultyFilters = toFilterList(difficulty).map(Number).filter((item) => difficulties.includes(item))
  const sortBy = typeof sort === 'string' ? sort : 'newest'
  const query = typeof q === 'string' ? q.toLocaleLowerCase('ko-KR') : ''
  let items = store.problems.filter((problem): problem is Problem => Boolean(problem && typeof problem === 'object' && problem.id)).filter((problem) => (!subjectFilters.length || subjectFilters.includes(problem.subject)) &&
    (!gradeFilters.length || gradeFilters.includes(problem.grade)) && (!difficultyFilters.length || difficultyFilters.includes(problem.difficulty)) &&
    (!query || `${problem.title} ${problem.description} ${problem.author}`.toLocaleLowerCase('ko-KR').includes(query)))
  items = [...items].sort((a, b) => {
    if (sortBy === 'views') return b.views - a.views
    if (sortBy === 'solved') return b.solvedBy.length - a.solvedBy.length
    if (sortBy === 'correct') return b.correctSubmissions - a.correctSubmissions
    if (sortBy === 'difficulty') return b.difficulty - a.difficulty
    return b.createdAt.localeCompare(a.createdAt)
  })
  res.json({ items: items.map(publicProblem), total: items.length })
})

app.post('/server/problems', async (req: Request, res: Response) => {
  const { title, description, subject, grade, difficulty, author, answer, explanation, managementPassword, photos } = req.body ?? {}
  if (!validProblemFields(req.body) || typeof managementPassword !== 'string' || managementPassword.length < 8 || managementPassword.length > 256) {
    res.status(400).json({ error: '문제 정보와 관리 암호(8자 이상)를 올바르게 입력해 주세요.' })
    return
  }
  const answerMaterial = await buildAnswerMaterial(answer, explanation)
  const managementPasswordHash = await hash(managementPassword, argon2Options)
  const problem: Problem = {
    id: randomBytes(12).toString('hex'), title: title.trim(), description: description.trim(), subject, grade,
    difficulty: Number(difficulty), author: author.trim(), createdAt: new Date().toISOString(), views: 0,
    solvedBy: [], correctSubmissions: 0, ...answerMaterial, managementPasswordHash, photos: photos ?? [],
  }
  store.problems.unshift(problem)
  await persist()
  res.status(201).json({ item: publicProblem(problem, true) })
})

app.get('/server/problems/:id', async (req: Request, res: Response) => {
  const problem = store.problems.find((item) => item.id === req.params.id)
  if (!problem) { res.status(404).json({ error: '문제를 찾을 수 없습니다.' }); return }
  problem.views += 1
  await persist()
  res.json({ item: publicProblem(problem, true) })
})

app.post('/server/problems/:id/answer', async (req: Request, res: Response) => {
  if (limitAttempts(req, res)) return
  const problem = store.problems.find((item) => item.id === req.params.id)
  if (!problem) { res.status(404).json({ error: '문제를 찾을 수 없습니다.' }); return }
  const answer = req.body?.answer
  if (typeof answer !== 'string' || answer.length > 200) { res.status(400).json({ error: '정답을 입력해 주세요.' }); return }
  const keys = await deriveKeys(answer, Buffer.from(problem.answerSalt, 'base64'))
  const candidate = createHmac('sha256', keys.subarray(32)).update('sturrl-answer-verifier-v1').digest()
  const expected = Buffer.from(problem.answerVerifier, 'base64')
  const correct = candidate.length === expected.length && timingSafeEqual(candidate, expected)
  if (!correct) { res.json({ correct: false, error: '정답이 아닙니다. 다시 생각해 보세요.' }); return }
  problem.correctSubmissions += 1
  const visitorId = getVisitorId(req, res)
  if (!problem.solvedBy.includes(visitorId)) problem.solvedBy.push(visitorId)
  const encrypted = problem.explanation
  const decipher = createDecipheriv('aes-256-gcm', keys.subarray(0, 32), Buffer.from(encrypted.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'))
  const explanation = Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'base64')), decipher.final()]).toString('utf8')
  await persist()
  res.json({ correct: true, explanation, solvedCount: problem.solvedBy.length, correctSubmissions: problem.correctSubmissions })
})

async function authorizeManagement(problem: Problem, password: unknown) {
  if (typeof password !== 'string' || password.length < 1 || password.length > 256) return false

  const masterPasswordHash = process.env.MASTER_PASSWORD_HASH
  if (masterPasswordHash) {
    try {
      if (await verify(masterPasswordHash, password)) return true
    } catch {
      // An invalid master hash must not prevent the problem-specific password check.
    }
  }

  if (!problem.managementPasswordHash) return false
  try { return await verify(problem.managementPasswordHash, password) } catch { return false }
}

app.put('/server/problems/:id', async (req: Request, res: Response) => {
  const problem = store.problems.find((item) => item.id === req.params.id)
  if (!problem) { res.status(404).json({ error: '문제를 찾을 수 없습니다.' }); return }
  if (!await authorizeManagement(problem, req.body?.managementPassword)) {
    res.status(403).json({ error: '관리 암호가 올바르지 않습니다.' }); return
  }
  const { title, description, subject, grade, difficulty, author, answer, explanation } = req.body ?? {}
  if (!validProblemFields(req.body)) {
    res.status(400).json({ error: '수정할 문제 정보, 정답, 해설을 올바르게 입력해 주세요.' }); return
  }
  const answerMaterial = await buildAnswerMaterial(answer, explanation)
  Object.assign(problem, {
    title: title.trim(), description: description.trim(), subject, grade, difficulty: Number(difficulty),
    author: author.trim(), ...answerMaterial, photos: req.body.photos ?? problem.photos ?? [], updatedAt: new Date().toISOString(),
  })
  await persist()
  res.json({ item: publicProblem(problem, true) })
})

app.delete('/server/problems/:id', async (req: Request, res: Response) => {
  const problem = store.problems.find((item) => item.id === req.params.id)
  if (!problem) { res.status(404).json({ error: '문제를 찾을 수 없습니다.' }); return }
  if (!await authorizeManagement(problem, req.body?.managementPassword)) {
    res.status(403).json({ error: '관리 암호가 올바르지 않습니다.' }); return
  }
  store.problems = store.problems.filter((item) => item.id !== problem.id)
  await persist()
  res.status(204).end()
})

async function start() {
  await mkdir(dataDir, { recursive: true })
  try {
    const parsed = JSON.parse(await readFile(dataFile, 'utf8')) as Partial<Store>
    store = {
      problems: Array.isArray(parsed.problems)
        ? parsed.problems.filter((problem): problem is Problem => Boolean(problem && typeof problem === 'object' && typeof problem.id === 'string'))
        : [],
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await persist()
  }
  if (process.env.ANSWER_PEPPER === undefined) console.warn('[Sturrl] ANSWER_PEPPER is not set; using development fallback. Set a strong secret in production.')
  if (isProduction) {
    const clientDir = resolve(rootDir, 'dist')
    app.use(express.static(clientDir))
    app.get(/.*/, (_req, res) => res.sendFile(resolve(clientDir, 'index.html')))
  } else {
    const vite = await createViteServer({ configFile: resolve(rootDir, 'vite.config.ts'), root: rootDir, server: { middlewareMode: true }, appType: 'spa' })
    app.use(vite.middlewares)
  }
  app.listen(port, '0.0.0.0', () => {
    console.log(`[Sturrl] Server ready at http://localhost:${port}`)
    console.log(`[Sturrl] API available at http://localhost:${port}/server/`)
    if (!isProduction) console.log('[Sturrl] Vite HMR enabled')
  })
}
start().catch((error: unknown) => { console.error('[Sturrl] Failed to start:', error); process.exit(1) })
