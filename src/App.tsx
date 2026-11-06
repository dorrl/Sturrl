import { useEffect, useMemo, useState, type FormEvent } from 'react'
import './App.css'

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

const categories = ['전체', '수학', '과학', '프로그래밍', '기타']

function timeAgo(value: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 60) return `${minutes}분 전`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`
  return `${Math.floor(minutes / 1440)}일 전`
}

function App() {
  const [problems, setProblems] = useState<Problem[]>([])
  const [category, setCategory] = useState('전체')
  const [search, setSearch] = useState('')
  const [showComposer, setShowComposer] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [newCategory, setNewCategory] = useState('수학')
  const [author, setAuthor] = useState('익명')

  async function loadProblems() {
    try {
      const response = await fetch('/server/problems')
      if (!response.ok) throw new Error('문제 목록을 불러오지 못했습니다.')
      const data = await response.json() as { items: Problem[] }
      setProblems(data.items)
      setError('')
    } catch {
      setError('서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadProblems() }, [])

  const filteredProblems = useMemo(() => problems.filter((problem) => {
    const matchesCategory = category === '전체' || problem.category === category
    const query = search.trim().toLowerCase()
    const matchesSearch = !query || `${problem.title} ${problem.description} ${problem.author}`.toLowerCase().includes(query)
    return matchesCategory && matchesSearch
  }), [problems, category, search])

  async function submitProblem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const response = await fetch('/server/problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, category: newCategory, author }),
      })
      const data = await response.json() as { item?: Problem; error?: string }
      if (!response.ok || !data.item) throw new Error(data.error ?? '문제를 등록하지 못했습니다.')
      setProblems((current) => [data.item!, ...current])
      setTitle('')
      setDescription('')
      setShowComposer(false)
      setCategory('전체')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '문제를 등록하지 못했습니다.')
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Sturrl 홈"><span className="brand-mark">S</span>sturrl<span className="brand-dot">.</span></a>
        <nav className="top-links"><a className="active" href="#problems">문제 둘러보기</a><a href="#about">서비스 소개</a></nav>
        <button className="profile-button" type="button" onClick={() => setShowComposer(true)}>문제 공유하기 <span>＋</span></button>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> SHARE · SOLVE · GROW</div>
            <h1>혼자 고민하지 말고,<br /><em>함께 풀어봐요.</em></h1>
            <p>막히는 문제를 공유하고, 서로의 풀이에서 새로운 힌트를 발견해 보세요.</p>
            <button className="hero-cta" type="button" onClick={() => setShowComposer(true)}>내 문제 공유하기 <span>↗</span></button>
          </div>
          <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="floating-card card-back"><span className="mini-label">TODAY'S TIP</span><strong>다른 시선으로<br />다시 생각하기</strong><span className="spark">✳</span></div><div className="floating-card card-front"><span className="card-icon">✎</span><div><b>좋은 질문은</b><small>좋은 답변의 시작!</small></div><span className="card-check">✓</span></div><div className="hero-star star-a">✳</div><div className="hero-star star-b">✦</div></div>
          <div className="hero-stats"><div><strong>{problems.length.toString().padStart(2, '0')}</strong><span>공유된 문제</span></div><i /><div><strong>함께</strong><span>배우는 커뮤니티</span></div><i /><div><strong>∞</strong><span>가능성</span></div></div>
        </section>
        <section className="problem-section" id="problems">
          <div className="section-heading"><div><span className="section-kicker">COMMUNITY</span><h2>지금 올라온 문제</h2><p>궁금했던 질문을 찾거나, 새로운 문제를 공유해 보세요.</p></div><button className="text-button" type="button" onClick={() => setShowComposer(true)}>문제 작성하기 <span>↗</span></button></div>
          <div className="toolbar"><div className="category-tabs" role="tablist" aria-label="분야 필터">{categories.map((item) => <button key={item} type="button" role="tab" aria-selected={category === item} className={category === item ? 'selected' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="궁금한 문제 검색하기" /></label></div>
          {error && <div className="notice" role="status">{error}</div>}
          {loading ? <div className="empty-state">문제를 불러오는 중이에요...</div> : filteredProblems.length === 0 ? <div className="empty-state">아직 등록된 문제가 없어요. 첫 번째 문제를 공유해 보세요!</div> : <div className="problem-grid">{filteredProblems.map((problem, index) => <article className="problem-card" key={problem.id}><div className="problem-card-top"><span className={`category-badge badge-${problem.category === '수학' ? 'math' : problem.category === '과학' ? 'science' : problem.category === '프로그래밍' ? 'code' : 'etc'}`}>{problem.category}</span><span className="card-time">{timeAgo(problem.createdAt)}</span></div><h3>{problem.title}</h3><p className="problem-description">{problem.description}</p><div className="problem-card-bottom"><span className="author-avatar">{problem.author.slice(0, 1).toUpperCase()}</span><span className="author-name">{problem.author}</span><span className="card-metric">♡ {problem.views}</span><span className="card-metric">▤ {problem.answers}</span></div><span className="card-number">0{index + 1}</span></article>)}</div>}
        </section>
        <section className="bottom-banner" id="about"><div><span className="section-kicker">YOUR NEXT IDEA STARTS HERE</span><h2>질문하는 순간,<br />배움은 시작돼요.</h2></div><button type="button" onClick={() => setShowComposer(true)}>지금 질문하기 <span>↗</span></button><div className="banner-decoration">?</div></section>
      </main>
      <footer><a className="brand footer-brand" href="/"><span className="brand-mark">S</span>sturrl<span className="brand-dot">.</span></a><span>Share what you wonder. Solve it together.</span><span>© 2026 Sturrl</span></footer>
      {showComposer && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowComposer(false) }}><section className="composer" role="dialog" aria-modal="true" aria-labelledby="composer-title"><div className="composer-heading"><div><span className="section-kicker">SHARE YOUR QUESTION</span><h2 id="composer-title">어떤 문제가 궁금한가요?</h2></div><button className="close-button" type="button" onClick={() => setShowComposer(false)} aria-label="닫기">×</button></div><form onSubmit={submitProblem}><label>제목<input required minLength={3} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="문제를 한 문장으로 표현해 주세요" /></label><label>상세 내용<textarea required minLength={5} maxLength={5000} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="어디가 어려운지, 어떤 부분이 궁금한지 적어주세요." /></label><div className="form-row"><label>분야<select value={newCategory} onChange={(event) => setNewCategory(event.target.value)}><option>수학</option><option>과학</option><option>프로그래밍</option><option>기타</option></select></label><label>작성자<input required maxLength={30} value={author} onChange={(event) => setAuthor(event.target.value)} /></label></div><button className="submit-button" type="submit">문제 공유하기 <span>↗</span></button></form></section></div>}
    </div>
  )
}

export default App