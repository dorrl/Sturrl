export const subjects = ['국어', '영어', '수학', '사회', '과학', '한국사', '기타']
export const grades = ['중1', '중2', '중3', '고1', '고2', '고3', '대학생', '기타']
export const levels = [1, 2, 3, 4, 5]

export type Problem = {
  id: string
  title: string
  description: string
  subject: string
  grade: string
  difficulty: number
  author: string
  createdAt: string
  updatedAt?: string
  views: number
  solvedCount: number
  attempts: number
  correctSubmissions: number
  photoCount: number
  photos?: string[]
  reviewCount: number
  averageRating: number | null
}

export type Viewer = { solved: boolean; rating: number | null }
export type Detail = { item: Problem; viewer: Viewer }
export type Navigate = (path: string) => void

export function problemPath(id: string) {
  return '/problem/' + encodeURIComponent(id)
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/server' + path, options)
  if (response.status === 204) return undefined as T
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? '요청을 처리하지 못했어요.')
  return data as T
}

export function jsonRequest(method: string, body: object): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export function errorMessage(error: unknown) {
  return error instanceof Error && !(error instanceof SyntaxError) && !(error instanceof TypeError)
    ? error.message
    : '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.'
}

export const number = new Intl.NumberFormat('ko-KR')
export const date = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' })
