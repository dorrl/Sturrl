import { useEffect, useState } from 'react'
import { api, errorMessage, grades, levels, number, problemPath, subjects, type Navigate, type Problem } from './model'
import { Icon, Link, Notice } from './ui'

const sorts = { newest: '최신순', views: '조회순', solved: '풀이자순', correct: '정답 제출순', difficulty: '난이도순' }
type ListResult = { items: Problem[]; stats: { problemCount: number; correctSubmissions: number } }
type ListState = { query: string; revision: number; result?: ListResult; error?: string }

function Hero({ stats, navigate }: { stats?: ListResult['stats']; navigate: Navigate }) {
  return <section className="hero" aria-labelledby="hero-title">
    <div className="hero-content">
      <span className="hero-label"><Icon name="book" /> 함께 공부하는 문제 은행</span>
      <h1 id="hero-title">문제를 나누고,<br /><em>함께 풀어요.</em></h1>
      <p>직접 만든 문제를 공유하고 다른 사람의 문제에 도전해 보세요.<br className="wide-only" /> 정답을 맞히면 출제자가 남긴 해설이 열려요.</p>
      <Link className="button hero-button" href="/create" navigate={navigate}><Icon name="plus" /> 문제 올리기</Link>
    </div>
    <div className="hero-art" aria-hidden="true">
      <div className="art-orbit" />
      <div className="art-paper art-back" />
      <div className="art-paper art-front">
        <div className="paper-binding"><i /><i /><i /></div>
        <div className="paper-lines"><i /><i /></div>
        <div className="paper-graph"><i className="graph-line" /><i className="graph-curve" /><i className="graph-point" /></div>
        <div className="paper-equation">y = x²</div>
      </div>
      <div className="art-check"><Icon name="check" /></div>
      <div className="art-pencil" />
      <span className="art-sparkle">✳</span>
    </div>
    <div className="hero-stats">
      <span><b>{stats ? number.format(stats.problemCount) : '–'}</b> 공유된 문제</span>
      <span><b>{stats ? number.format(stats.correctSubmissions) : '–'}</b> 정답 제출</span>
    </div>
  </section>
}

function FilterGroup({ title, values, selected, onToggle, onClear }: {
  title: string
  values: string[]
  selected: string[]
  onToggle: (value: string) => void
  onClear: () => void
}) {
  return <fieldset className="filter-group">
    <legend>{title}</legend>
    <div className="filter-options">
      <button type="button" aria-pressed={!selected.length} onClick={onClear}>전체</button>
      {values.map((item) => <button type="button" key={item} aria-pressed={selected.includes(item)} onClick={() => onToggle(item)}>{item}</button>)}
    </div>
  </fieldset>
}

function ProblemCard({ problem, saved, toggleBookmark, navigate }: {
  problem: Problem
  saved: boolean
  toggleBookmark: (id: string) => void
  navigate: Navigate
}) {
  return <article className="problem-card">
    <div className="card-main">
      <div className="card-top"><span className="subject-tag" data-subject={problem.subject}>{problem.subject}</span><span>{problem.grade}</span><span>난이도 {problem.difficulty}/5</span></div>
      <h3><Link href={problemPath(problem.id)} navigate={navigate}>{problem.title}</Link></h3>
      {problem.description && <p className="card-description">{problem.description}</p>}
      <div className="card-meta">
        <span className="card-author">{problem.author}</span>
        <span><Icon name="eye" /> {number.format(problem.views)}</span>
        <span><Icon name="check" /> {number.format(problem.solvedCount)}명 풀이</span>
        {problem.photoCount > 0 && <span><Icon name="image" /> {problem.photoCount}</span>}
        {problem.averageRating !== null && <span className="rating-value"><Icon name="star" filled /> {problem.averageRating.toFixed(1)} ({problem.reviewCount})</span>}
      </div>
    </div>
    <button className="icon-button bookmark-button" type="button" aria-label={problem.title + ' 보관함에 저장'} aria-pressed={saved} onClick={() => toggleBookmark(problem.id)}><Icon name="bookmark" filled={saved} /></button>
  </article>
}

export function Library({ savedOnly, query, replaceQuery, bookmarks, toggleBookmark, navigate }: {
  savedOnly: boolean
  query: string
  replaceQuery: (next: URLSearchParams) => void
  bookmarks: string[]
  toggleBookmark: (id: string) => void
  navigate: Navigate
}) {
  const [state, setState] = useState<ListState>()
  const [revision, setRevision] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const params = new URLSearchParams(query)
  const search = params.get('q') ?? ''
  const filters = [
    { label: '과목', key: 'subject', values: subjects },
    { label: '학년', key: 'grade', values: grades },
    { label: '난이도', key: 'difficulty', values: levels.map(String) },
  ]
  const groups = filters.map((group) => ({ ...group, selected: params.getAll(group.key).filter((value) => group.values.includes(value)) }))
  const activeFilters = groups.reduce((count, group) => count + group.selected.length, 0)
  const hasFilters = activeFilters > 0
  const sort = params.get('sort') ?? 'newest'

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const result = await api<ListResult>('/problems?' + query, { signal: controller.signal })
        if (!controller.signal.aborted) setState({ query, revision, result })
      } catch (error) {
        if (!controller.signal.aborted) setState({ query, revision, error: errorMessage(error) })
      }
    }, new URLSearchParams(query).has('q') ? 220 : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, revision])

  const current = state?.query === query && state.revision === revision ? state : undefined
  const items = current?.result?.items.filter((item) => !savedOnly || bookmarks.includes(item.id)) ?? []
  const emptySaved = savedOnly && !search && !hasFilters

  function setParam(key: string, value: string) {
    if (value) params.set(key, value)
    else params.delete(key)
    replaceQuery(params)
  }

  return <>
    {savedOnly ? <section className="saved-heading"><span className="saved-icon"><Icon name="bookmark" /></span><h1>내 보관함</h1><p>이 브라우저에서 저장한 문제를 다시 풀어보세요.</p></section>
      : <Hero stats={state?.result?.stats} navigate={navigate} />}
    <section className="library" aria-labelledby="library-title">
      <div className="library-heading">
        <div><h2 id="library-title">{savedOnly ? '저장한 문제' : '문제 둘러보기'}</h2><p>{savedOnly ? '저장해 둔 문제까지 검색할 수 있어요.' : '관심 있는 과목을 고르고 새로운 문제를 만나보세요.'}</p></div>
        <label className="search"><Icon name="search" /><input type="search" aria-label="문제 검색" maxLength={120} placeholder="제목, 내용, 작성자 검색" value={search} onChange={(event) => setParam('q', event.target.value)} />
          {search && <button className="icon-button clear-search" type="button" aria-label="검색어 지우기" onClick={() => setParam('q', '')}><Icon name="x" /></button>}
        </label>
      </div>
      <div className="library-layout">
        <aside className="filters" aria-label="문제 필터">
          <div className="filters-heading">
            <strong><Icon name="filter" /> 필터</strong>
            <button className="filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="library-filters" onClick={() => setFiltersOpen(!filtersOpen)}>
              <Icon name="filter" /> 필터{hasFilters ? ' (' + activeFilters + ')' : ''} <Icon name="chevron" />
            </button>
            <button className="text-button" type="button" disabled={!hasFilters} onClick={() => {
              groups.forEach(({ key }) => params.delete(key))
              replaceQuery(params)
            }}>초기화</button>
          </div>
          <div id="library-filters" className={'filter-content' + (filtersOpen ? ' is-open' : '')}>
            {groups.map(({ key, label, values, selected }) => <FilterGroup key={key} title={label} values={values} selected={selected}
              onToggle={(value) => {
                params.delete(key)
                const next = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]
                next.forEach((item) => params.append(key, item))
                replaceQuery(params)
              }} onClear={() => setParam(key, '')} />)}
          </div>
        </aside>
        <div className="results">
          <div className="results-toolbar">
            <div className="result-count" role="status">{current?.result ? <>문제 <b>{number.format(items.length)}개</b></> : '문제 목록'}</div>
            <label className="select-wrap"><select aria-label="문제 정렬" value={Object.hasOwn(sorts, sort) ? sort : 'newest'} onChange={(event) => setParam('sort', event.target.value === 'newest' ? '' : event.target.value)}>
              {Object.entries(sorts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select><Icon name="chevron" /></label>
          </div>
          {current?.error ? <div className="empty"><Notice>{current.error}</Notice><button className="button secondary" type="button" onClick={() => setRevision(revision + 1)}>다시 시도</button></div>
            : !current ? <div className="empty loading" role="status">문제를 불러오고 있어요.</div>
              : items.length > 0 ? <div className="problem-list">{items.map((problem) => <ProblemCard key={problem.id} problem={problem} saved={bookmarks.includes(problem.id)} toggleBookmark={toggleBookmark} navigate={navigate} />)}</div>
                : <div className="empty">
                  <span className="empty-icon"><Icon name={emptySaved ? 'bookmark' : 'search'} /></span>
                  <h3>{emptySaved ? '저장한 문제가 없어요' : hasFilters || search ? '조건에 맞는 문제가 없어요' : '아직 등록된 문제가 없어요'}</h3>
                  <p>{emptySaved ? '문제의 책갈피를 누르면 이곳에 표시돼요.' : hasFilters || search ? '검색어나 필터를 바꿔 보세요.' : '첫 번째 문제를 공유해 보세요.'}</p>
                  {emptySaved ? <Link className="button secondary" href="/" navigate={navigate}>문제 둘러보기</Link>
                    : hasFilters || search ? <button className="button secondary" type="button" onClick={() => replaceQuery(new URLSearchParams())}>검색 및 필터 초기화</button>
                      : <Link className="button primary" href="/create" navigate={navigate}>문제 올리기</Link>}
                </div>}
        </div>
      </div>
    </section>
  </>
}
