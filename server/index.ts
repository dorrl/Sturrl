import express, { type Request, type Response } from 'express'
import { createServer as createViteServer } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const port = Number(process.env.PORT ?? 3000)
const isProduction = process.env.NODE_ENV === 'production'
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

type Problem = {
  id: string
  title: string
  description: string
  category: string
  author: string
  createdAt: string
  views: number
  answers: number
}

const problems: Problem[] = [
  {
    id: 'p-001',
    title: '이차함수의 최댓값과 최솟값을 구하는 방법',
    description: '꼭짓점의 x좌표를 구한 뒤 함수값을 대입하는 과정이 헷갈립니다. 풀이 과정을 설명해 주세요.',
    category: '수학',
    author: 'study_fox',
    createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    views: 128,
    answers: 4,
  },
  {
    id: 'p-002',
    title: '파이썬에서 비동기 함수가 실행되는 순서',
    description: 'async와 await를 사용했을 때 일반 함수와 실행 순서가 어떻게 달라지는지 궁금해요.',
    category: '프로그래밍',
    author: 'bytebean',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    views: 96,
    answers: 7,
  },
  {
    id: 'p-003',
    title: '뉴턴 운동 법칙 문제 풀이 도움 요청',
    description: '마찰력이 있는 경사면에서 물체에 작용하는 힘을 어떤 방향으로 분해해야 할까요?',
    category: '과학',
    author: 'orbit_22',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    views: 74,
    answers: 2,
  },
]

app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

app.get('/server/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'sturrl-api', timestamp: new Date().toISOString() })
})

app.get('/server/problems', (_req: Request, res: Response) => {
  res.json({ items: problems, total: problems.length })
})

app.post('/server/problems', (req: Request, res: Response) => {
  const { title, description, category, author } = req.body ?? {}
  if (
    typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 120 ||
    typeof description !== 'string' || description.trim().length < 5 || description.trim().length > 5000 ||
    typeof category !== 'string' || category.trim().length === 0 ||
    typeof author !== 'string' || author.trim().length === 0
  ) {
    res.status(400).json({ error: '제목, 내용, 분야, 작성자를 올바르게 입력해 주세요.' })
    return
  }

  const problem: Problem = {
    id: `p-${Date.now()}`,
    title: title.trim(),
    description: description.trim(),
    category: category.trim(),
    author: author.trim().slice(0, 30),
    createdAt: new Date().toISOString(),
    views: 0,
    answers: 0,
  }
  problems.unshift(problem)
  res.status(201).json({ item: problem })
})

async function start() {
  if (isProduction) {
    const clientDir = resolve(rootDir, 'dist')
    app.use(express.static(clientDir))
    app.get(/.*/, (_req, res) => res.sendFile(resolve(clientDir, 'index.html')))
  } else {
    const vite = await createViteServer({
      configFile: resolve(rootDir, 'vite.config.ts'),
      root: rootDir,
      server: { middlewareMode: true },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`[Sturrl] Server ready at http://localhost:${port}`)
    console.log(`[Sturrl] API available at http://localhost:${port}/server/`)
    if (!isProduction) console.log('[Sturrl] Vite HMR enabled')
  })
}

start().catch((error: unknown) => {
  console.error('[Sturrl] Failed to start:', error)
  process.exit(1)
})