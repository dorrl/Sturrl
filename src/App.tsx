import { useEffect, useMemo, useState, type FormEvent } from 'react'
import './App.css'

type Problem = {
  id: string; title: string; description: string; subject: string; grade: string; difficulty: number
  author: string; createdAt: string; views: number; solvedCount: number; correctSubmissions: number; photos?: string[]
}
type Sort = 'newest' | 'views' | 'solved' | 'correct' | 'difficulty'
const subjects = ['국어', '영어', '수학', '사회', '과학', '한국사']
const grades = ['중1', '중2', '중3', '고1', '고2', '고3', '대학생']
const MAX_PHOTO_BYTES = 100 * 1024 * 1024
const MAX_COMPRESSED_PHOTO_CHARS = 4_200_000
const sortLabels: Record<Sort, string> = { newest: '최신순', views: '조회순', solved: '푼 사람순', correct: '정답 제출순', difficulty: '난이도순' }

function timeAgo(value: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 60) return `${minutes}분 전`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`
  return `${Math.floor(minutes / 1440)}일 전`
}

async function compressPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 업로드할 수 있어요.')
  if (file.size >= MAX_PHOTO_BYTES) throw new Error('사진 원본은 100MB 미만이어야 해요.')
  const source = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 1920 / Math.max(source.width, source.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(source.width * scale))
    canvas.height = Math.max(1, Math.round(source.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('이미지를 압축할 수 없습니다.')
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    let quality = 0.82
    let result = canvas.toDataURL('image/webp', quality)
    while (result.length > MAX_COMPRESSED_PHOTO_CHARS && quality > 0.35) {
      quality -= 0.1
      result = canvas.toDataURL('image/webp', quality)
    }
    if (result.length > MAX_COMPRESSED_PHOTO_CHARS) throw new Error('압축 후에도 사진 용량이 커요. 더 작은 사진을 선택해 주세요.')
    return result
  } finally { source.close() }
}

function App() {
  const [problems, setProblems] = useState<Problem[]>([])
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([])
  const [selectedGrades, setSelectedGrades] = useState<string[]>([])
  const [selectedDifficulties, setSelectedDifficulties] = useState<string[]>([])
  const [darkMode, setDarkMode] = useState(false)
  const [sort, setSort] = useState<Sort>('newest')
  const [search, setSearch] = useState('')
  const [showComposer, setShowComposer] = useState(false)
  const [selected, setSelected] = useState<Problem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [newSubject, setNewSubject] = useState('수학')
  const [newGrade, setNewGrade] = useState('중1')
  const [newDifficulty, setNewDifficulty] = useState('3')
  const [author, setAuthor] = useState('익명')
  const [answer, setAnswer] = useState('')
  const [explanation, setExplanation] = useState('')
  const [managementPassword, setManagementPassword] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [photoError, setPhotoError] = useState('')
  const [editing, setEditing] = useState(false)
  const [editPassword, setEditPassword] = useState('')
  const [submittedAnswer, setSubmittedAnswer] = useState('')
  const [unlockedExplanation, setUnlockedExplanation] = useState('')
  const [answerError, setAnswerError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function loadProblems() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      selectedSubjects.forEach((value) => params.append('subject', value))
      selectedGrades.forEach((value) => params.append('grade', value))
      selectedDifficulties.forEach((value) => params.append('difficulty', value))
      if (sort) params.set('sort', sort)
      if (search.trim()) params.set('q', search.trim())
      const response = await fetch(`/server/problems?${params}`)
      if (!response.ok) throw new Error('문제 목록을 불러오지 못했습니다.')
      const data = await response.json() as { items?: Array<Problem | null> }
      // Treat malformed/null API entries as invalid instead of letting the UI dereference them.
      setProblems(Array.isArray(data.items) ? data.items.filter((item): item is Problem => Boolean(item && typeof item === 'object' && typeof item.id === 'string')) : [])
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '서버에 연결할 수 없습니다.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void loadProblems() }, [selectedSubjects, selectedGrades, selectedDifficulties, sort, search])
  useEffect(() => {
    setDarkMode(window.localStorage.getItem('sturrl-theme') === 'dark')
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'
    window.localStorage.setItem('sturrl-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  function toggleFilter(values: string[], value: string, setter: (next: string[]) => void) {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  }
  const totalSolved = useMemo(() => problems.reduce((sum, item) => sum + (item?.solvedCount ?? 0), 0), [problems])

  function clearComposer() {
    setShowComposer(false); setEditing(false); setTitle(''); setDescription(''); setAnswer(''); setExplanation('')
    setManagementPassword(''); setPhotos([]); setPhotoError(''); setNewSubject('수학'); setNewGrade('중1'); setNewDifficulty('3')
  }

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return
    setPhotoError('')
    const remaining = 5 - photos.length
    if (files.length > remaining) { setPhotoError(`사진은 문제당 최대 5장까지 올릴 수 있어요. 현재 추가 가능: ${remaining}장`); return }
    try {
      const compressed = await Promise.all(Array.from(files).map(compressPhoto))
      setPhotos((current) => [...current, ...compressed])
    } catch (cause) { setPhotoError(cause instanceof Error ? cause.message : '사진을 처리하지 못했습니다.') }
  }

  async function submitProblem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    try {
      const response = await fetch('/server/problems', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, subject: newSubject, grade: newGrade, difficulty: Number(newDifficulty), author, answer, explanation, managementPassword, photos }),
      })
      const data = await response.json() as { item?: Problem; error?: string }
      if (!response.ok || !data.item) throw new Error(data.error ?? '문제를 등록하지 못했습니다.')
      clearComposer(); await loadProblems()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '문제를 등록하지 못했습니다.') }
  }

  async function openProblem(problem: Problem) {
    setSelected(problem); setSubmittedAnswer(''); setUnlockedExplanation(''); setAnswerError('')
    setEditPassword(''); setEditing(false)
    try {
      const response = await fetch(`/server/problems/${problem.id}`)
      if (response.ok) {
        const data = await response.json() as { item: Problem }
        setSelected(data.item)
        setProblems((items) => items.map((item) => item.id === problem.id ? data.item : item))
      }
    } catch { /* detail remains available from the list response */ }
  }

  async function checkAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !submittedAnswer.trim()) return
    setSubmitting(true); setAnswerError('')
    try {
      const response = await fetch(`/server/problems/${selected.id}/answer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: submittedAnswer }),
      })
      const data = await response.json() as { correct?: boolean; explanation?: string; error?: string; solvedCount?: number; correctSubmissions?: number }
      if (!response.ok || !data.correct) { setAnswerError(data.error ?? '정답이 아닙니다. 다시 시도해 보세요.'); return }
      setUnlockedExplanation(data.explanation ?? '')
      setSelected({ ...selected, solvedCount: data.solvedCount ?? selected.solvedCount, correctSubmissions: data.correctSubmissions ?? selected.correctSubmissions })
      setProblems((items) => items.map((item) => item.id === selected.id ? { ...item, solvedCount: data.solvedCount ?? item.solvedCount, correctSubmissions: data.correctSubmissions ?? item.correctSubmissions } : item))
    } catch { setAnswerError('서버에 연결할 수 없습니다.') }
    finally { setSubmitting(false) }
  }

  function beginEdit() {
    if (!selected) return
    setTitle(selected.title); setDescription(selected.description); setNewSubject(selected.subject); setNewGrade(selected.grade)
    setNewDifficulty(String(selected.difficulty)); setAuthor(selected.author); setAnswer(''); setExplanation('')
    setPhotos(selected.photos ?? []); setPhotoError(''); setEditing(true); setEditPassword('')
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    setSubmitting(true); setAnswerError('')
    try {
      const response = await fetch(`/server/problems/${selected.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, subject: newSubject, grade: newGrade, difficulty: Number(newDifficulty), author, answer, explanation, managementPassword: editPassword, photos }),
      })
      const data = await response.json() as { item?: Problem; error?: string }
      if (!response.ok || !data.item) throw new Error(data.error ?? '문제를 수정하지 못했습니다.')
      setSelected(data.item); setProblems((items) => items.map((item) => item.id === data.item!.id ? data.item! : item))
      setEditing(false); setEditPassword(''); setUnlockedExplanation(''); setAnswer(''); setExplanation('')
    } catch (cause) { setAnswerError(cause instanceof Error ? cause.message : '문제를 수정하지 못했습니다.') }
    finally { setSubmitting(false) }
  }

  async function deleteProblem() {
    if (!selected) return
    const password = window.prompt('문제 관리 암호 또는 마스터 암호를 입력하세요.')
    if (password === null) return
    setSubmitting(true); setAnswerError('')
    try {
      const response = await fetch(`/server/problems/${selected.id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ managementPassword: password }),
      })
      if (!response.ok) {
        const data = await response.json() as { error?: string }
        throw new Error(data.error ?? '문제를 삭제하지 못했습니다.')
      }
      setSelected(null); await loadProblems()
    } catch (cause) { setAnswerError(cause instanceof Error ? cause.message : '문제를 삭제하지 못했습니다.') }
    finally { setSubmitting(false) }
  }

  const photoField = <div className="photo-upload"><label>문제 사진 <span className="form-hint">최대 5장 · 원본 100MB 미만 · 자동 압축(WebP)</span><input type="file" accept="image/*" multiple disabled={photos.length >= 5} onChange={(event) => { void addPhotos(event.target.files); event.currentTarget.value = '' }} /></label>{photoError && <p className="photo-error">{photoError}</p>}{photos.length > 0 && <div className="photo-preview-grid">{photos.map((photo, index) => <div className="photo-preview" key={index}><img src={photo} alt={`사진 ${index + 1} 미리보기`} /><button type="button" aria-label={`사진 ${index + 1} 삭제`} onClick={() => setPhotos((items) => items.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}</div>}<p className="form-hint">{photos.length}/5장 선택됨</p></div>

  const problemFields = <><label>문제 제목<input required minLength={3} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="문제를 한 문장으로 표현해 주세요" /></label><label>문제 내용<textarea required minLength={5} maxLength={5000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="문제의 조건과 질문을 자세히 적어주세요." /></label>{photoField}<div className="form-row"><label>과목<select value={newSubject} onChange={(event) => setNewSubject(event.target.value)}>{subjects.map((item) => <option key={item}>{item}</option>)}</select></label><label>학년<select value={newGrade} onChange={(event) => setNewGrade(event.target.value)}>{grades.map((item) => <option key={item}>{item}</option>)}</select></label></div><div className="form-row"><label>난이도<select value={newDifficulty} onChange={(event) => setNewDifficulty(event.target.value)}>{[1,2,3,4,5].map((item) => <option key={item} value={item}>{item} / 5</option>)}</select></label><label>작성자<input required maxLength={30} value={author} onChange={(event) => setAuthor(event.target.value)} /></label></div><label>정답<input required maxLength={200} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="정답을 입력하세요 (공개되지 않아요)" /></label><label>해설<textarea required maxLength={10000} rows={5} value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="정답을 맞힌 사람에게 공개할 해설을 입력하세요." /></label></>

  return (
    <div className={`app-shell${darkMode ? ' dark-mode' : ''}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Sturrl 홈"><span className="brand-mark">S</span>sturrl<span className="brand-dot">.</span></a>
        <nav className="top-links"><a className="active" href="#problems">문제 둘러보기</a><a href="#about">서비스 소개</a></nav>
        <div className="header-actions"><button className="theme-toggle" type="button" onClick={() => setDarkMode((value) => !value)} aria-label={darkMode ? '라이트 모드로 전환' : '다크 모드로 전환'}>{darkMode ? '☀ 라이트 모드' : '☾ 다크 모드'}</button><button className="profile-button" type="button" onClick={() => setShowComposer(true)}>문제 공유하기 <span>＋</span></button></div>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-dot" /> SHARE · SOLVE · GROW</div><h1>혼자 고민하지 말고,<br /><em>함께 풀어봐요.</em></h1><p>문제를 풀고 정답을 맞히면, 출제자가 남긴 해설을 확인할 수 있어요.</p><button className="hero-cta" type="button" onClick={() => setShowComposer(true)}>내 문제 공유하기 <span>↗</span></button></div>
          <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="floating-card card-back"><span className="mini-label">LEARN TOGETHER</span><strong>정답을 찾고<br />해설을 발견하기</strong><span className="spark">✳</span></div><div className="floating-card card-front"><span className="card-icon">✎</span><div><b>좋은 질문은</b><small>좋은 배움의 시작!</small></div><span className="card-check">✓</span></div><div className="hero-star star-a">✳</div><div className="hero-star star-b">✦</div></div>
          <div className="hero-stats"><div><strong>{problems.length.toString().padStart(2, '0')}</strong><span>검색된 문제</span></div><i /><div><strong>{totalSolved}</strong><span>누적 풀이자 합계</span></div><i /><div><strong>∞</strong><span>함께 배우는 가능성</span></div></div>
        </section>
        <section className="problem-section" id="problems">
          <div className="section-heading"><div><span className="section-kicker">COMMUNITY</span><h2>문제 둘러보기</h2><p>과목, 학년, 난이도를 골라 원하는 문제를 찾아보세요.</p></div><button className="text-button" type="button" onClick={() => setShowComposer(true)}>문제 작성하기 <span>↗</span></button></div>
          <div className="filter-panel">
            <div className="filter-line"><span className="filter-label">과목</span><div className="filter-options"><button type="button" className={selectedSubjects.length === 0 ? 'chosen' : ''} onClick={() => setSelectedSubjects([])}>전체</button>{subjects.map((item) => <button type="button" key={item} aria-pressed={selectedSubjects.includes(item)} className={selectedSubjects.includes(item) ? 'chosen' : ''} onClick={() => toggleFilter(selectedSubjects, item, setSelectedSubjects)}>{item}</button>)}</div></div>
            <div className="filter-line"><span className="filter-label">학년</span><div className="filter-options"><button type="button" className={selectedGrades.length === 0 ? 'chosen' : ''} onClick={() => setSelectedGrades([])}>전체</button>{grades.map((item) => <button type="button" key={item} aria-pressed={selectedGrades.includes(item)} className={selectedGrades.includes(item) ? 'chosen' : ''} onClick={() => toggleFilter(selectedGrades, item, setSelectedGrades)}>{item}</button>)}</div></div>
            <div className="filter-line"><span className="filter-label">난이도</span><div className="filter-options"><button type="button" className={selectedDifficulties.length === 0 ? 'chosen' : ''} onClick={() => setSelectedDifficulties([])}>전체</button>{[1,2,3,4,5].map((item) => <button type="button" key={item} aria-pressed={selectedDifficulties.includes(String(item))} className={selectedDifficulties.includes(String(item)) ? 'chosen' : ''} onClick={() => toggleFilter(selectedDifficulties, String(item), setSelectedDifficulties)}>{'★'.repeat(item)}</button>)}</div></div>
            <div className="filter-help">각 분류에서 여러 개를 선택하면 선택한 항목 중 하나라도 일치하는 문제를 보여줘요.</div>
          </div>
          <div className="toolbar"><div className="result-count">총 <b>{problems.length}</b>개의 문제</div><div className="toolbar-right"><label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="문제 검색하기" /></label><select className="sort-select" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>{Object.entries(sortLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div></div>
          {error && <div className="notice" role="status">{error}</div>}
          {loading ? <div className="empty-state">문제를 불러오는 중이에요...</div> : problems.length === 0 ? <div className="empty-state">조건에 맞는 문제가 없어요. 첫 번째 문제를 공유해 보세요!</div> : <div className="problem-grid">{problems.map((problem, index) => <button className="problem-card problem-card-button" key={problem.id} type="button" onClick={() => void openProblem(problem)}><div className="problem-card-top"><span className="category-badge badge-math">{problem.subject}</span><span className="card-time">{timeAgo(problem.createdAt)}</span></div><div className="problem-tags"><span>{problem.grade}</span><span>난이도 {'★'.repeat(problem.difficulty)}</span></div><h3>{problem.title}</h3><p className="problem-description">{problem.description}</p>{problem.photos?.length ? <div className="problem-photo-strip">{problem.photos.slice(0, 3).map((photo, photoIndex) => <img key={photoIndex} src={photo} alt="문제 사진" />)}{problem.photos.length > 3 && <span>+{problem.photos.length - 3}</span>}</div> : null}<div className="problem-card-bottom"><span className="author-avatar">{problem.author.slice(0, 1).toUpperCase()}</span><span className="author-name">{problem.author}</span><span className="card-metric">조회 {problem.views}</span><span className="card-metric">풀이 {problem.solvedCount}</span><span className="card-metric">정답 {problem.correctSubmissions}</span></div><span className="card-number">0{index + 1}</span></button>)}</div>}
        </section>
        <section className="bottom-banner" id="about"><div><span className="section-kicker">YOUR NEXT IDEA STARTS HERE</span><h2>질문하는 순간,<br />배움은 시작돼요.</h2></div><button type="button" onClick={() => setShowComposer(true)}>지금 질문하기 <span>↗</span></button><div className="banner-decoration">?</div></section>
      </main>
      <footer><a className="brand footer-brand" href="/"><span className="brand-mark">S</span>sturrl<span className="brand-dot">.</span></a><span>Share what you wonder. Solve it together.</span><span>© 2026 Sturrl</span></footer>

      {showComposer && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) clearComposer() }}><section className="composer" role="dialog" aria-modal="true" aria-labelledby="composer-title"><div className="composer-heading"><div><span className="section-kicker">SHARE YOUR QUESTION</span><h2 id="composer-title">문제와 해설을 공유해요</h2></div><button className="close-button" type="button" onClick={clearComposer} aria-label="닫기">×</button></div><form onSubmit={submitProblem}>{problemFields}<label>문제 관리 암호<input required minLength={8} maxLength={256} type="password" autoComplete="new-password" value={managementPassword} onChange={(event) => setManagementPassword(event.target.value)} placeholder="수정·삭제에 사용할 암호 (8자 이상)" /></label><p className="form-hint">관리 암호는 Argon2id로 해싱해 저장됩니다. 마스터 암호는 운영자가 서버 환경 변수로 별도 설정합니다.</p><button className="submit-button" type="submit">문제 공유하기 <span>↗</span></button></form></section></div>}

      {selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}><section className="composer detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><div className="composer-heading"><div><span className="section-kicker">{selected.subject} · {selected.grade} · 난이도 {selected.difficulty}/5</span><h2 id="detail-title">{selected.title}</h2></div><button className="close-button" type="button" onClick={() => setSelected(null)} aria-label="닫기">×</button></div>
        {editing ? <form onSubmit={saveEdit}>{problemFields}<label>관리 암호 또는 마스터 암호<input required type="password" autoComplete="current-password" value={editPassword} onChange={(event) => setEditPassword(event.target.value)} placeholder="문제 관리 암호 또는 마스터 암호" /></label>{answerError && <div className="notice">{answerError}</div>}<button className="submit-button" disabled={submitting} type="submit">{submitting ? '저장 중...' : '수정 내용 저장'} <span>↗</span></button><button className="secondary-button" type="button" onClick={() => setEditing(false)}>수정 취소</button></form> : <><p className="detail-description">{selected.description}</p>{selected.photos?.length ? <div className="detail-photo-grid">{selected.photos.map((photo, photoIndex) => <a key={photoIndex} href={photo} target="_blank" rel="noreferrer"><img src={photo} alt={`문제 사진 ${photoIndex + 1}`} /></a>)}</div> : null}<div className="detail-stats"><span>조회 {selected.views}</span><span>푼 사람 {selected.solvedCount}</span><span>정답 제출 {selected.correctSubmissions}</span></div>{unlockedExplanation ? <div className="unlocked-explanation"><div className="unlock-title">✓ 정답입니다! 해설이 열렸어요.</div><p>{unlockedExplanation}</p></div> : <form onSubmit={checkAnswer}><label>정답을 입력하면 해설을 볼 수 있어요<input required value={submittedAnswer} onChange={(event) => setSubmittedAnswer(event.target.value)} placeholder="정답 입력" /></label>{answerError && <div className="notice">{answerError}</div>}<button className="submit-button" disabled={submitting} type="submit">{submitting ? '확인 중...' : '정답 확인하고 해설 보기'} <span>↗</span></button></form>}<div className="management-actions"><button type="button" className="secondary-button" onClick={beginEdit}>문제 수정</button><button type="button" className="danger-button" disabled={submitting} onClick={() => void deleteProblem()}>문제 삭제</button></div>{answerError && !unlockedExplanation && <div className="notice">{answerError}</div>}</>}
      </section></div>}
    </div>
  )
}
export default App
