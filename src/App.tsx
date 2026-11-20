import { useEffect, useState } from 'react'
import { DetailPage } from './Detail'
import { Library } from './Library'
import { Composer } from './Composer'
import { Icon, Link } from './ui'
import './App.css'

const savedKey = 'sturrl-saved-problems'
function readLocal(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeLocal(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* Storage can be disabled. */ }
}
function savedIds(value: string | null): string[] {
  try {
    const items: unknown = JSON.parse(value ?? '[]')
    return Array.isArray(items) ? items.filter((item) => typeof item === 'string') : []
  } catch { return [] }
}
function locationPath() {
  return window.location.pathname + window.location.search
}

function App() {
  const [location, setLocation] = useState(locationPath)
  const [bookmarks, setBookmarks] = useState(() => savedIds(readLocal(savedKey)))
  const [darkMode, setDarkMode] = useState(() => readLocal('sturrl-theme') === 'dark')
  const separator = location.indexOf('?')
  const path = separator === -1 ? location : location.slice(0, separator)
  const query = separator === -1 ? '' : location.slice(separator + 1)
  const isLibrary = path === '/' || path === '/saved'
  const problemId = /^\/problem\/([^/]+)\/?$/.exec(path)?.[1]

  useEffect(() => {
    const onPop = () => setLocation(locationPath())
    const onStorage = (event: StorageEvent) => {
      if (event.key === savedKey || event.key === null) setBookmarks(savedIds(event.newValue))
      if (event.key === 'sturrl-theme' || event.key === null) setDarkMode(event.newValue === 'dark')
    }
    window.addEventListener('popstate', onPop)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'
  }, [darkMode])
  useEffect(() => {
    document.title = path === '/saved' ? '내 보관함 · Sturrl' : path === '/create' ? '문제 올리기 · Sturrl' : 'Sturrl · 문제를 나누는 공부 공간'
  }, [path])

  function navigate(next: string) {
    if (next === locationPath()) return
    window.history.pushState({ from: isLibrary ? location : window.history.state?.from }, '', next)
    setLocation(next)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  function replaceQuery(next: URLSearchParams) {
    const search = next.toString()
    const target = path + (search ? '?' + search : '')
    window.history.replaceState(window.history.state, '', target)
    setLocation(target)
  }

  function toggleBookmark(id: string) {
    const existing = readLocal(savedKey)
    const current = existing === null ? bookmarks : savedIds(existing)
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    writeLocal(savedKey, JSON.stringify(next))
    setBookmarks(next)
  }

  function toggleTheme() {
    const next = !darkMode
    writeLocal('sturrl-theme', next ? 'dark' : 'light')
    setDarkMode(next)
  }

  const from: unknown = window.history.state?.from
  const listPath = typeof from === 'string' && /^\/(saved)?(\?|$)/.test(from) ? from : '/'

  return <>
    <a className="skip-link" href="#main">본문으로 건너뛰기</a>
    <header className="topbar">
      <div className="container topbar-inner">
        <Link className="brand" href="/" navigate={navigate}><span className="brand-mark"><Icon name="book" /></span>sturrl<span className="brand-period">.</span></Link>
        <nav className="navigation" aria-label="주 메뉴">
          <Link href="/" navigate={navigate} current={path === '/'}>문제 둘러보기</Link>
          <Link href="/saved" navigate={navigate} current={path === '/saved'}><Icon name="bookmark" /> 내 보관함</Link>
        </nav>
        <div className="header-actions">
          <button className="icon-button theme-button" type="button" aria-label={darkMode ? '밝은 테마' : '어두운 테마'} onClick={toggleTheme}><Icon name={darkMode ? 'sun' : 'moon'} /></button>
          <Link className="button primary header-create" href="/create" navigate={navigate}><Icon name="plus" /> 문제 올리기</Link>
        </div>
      </div>
    </header>
    <main id="main" className="container">
      {isLibrary ? <Library key={path} savedOnly={path === '/saved'} query={query} replaceQuery={replaceQuery} bookmarks={bookmarks} toggleBookmark={toggleBookmark} navigate={navigate} />
        : path === '/create' ? <Composer key="create" navigate={navigate} back={listPath} />
          : problemId ? <DetailPage key={path} id={problemId} navigate={navigate} back={listPath}
            bookmarks={bookmarks} toggleBookmark={toggleBookmark} />
            : <section className="empty standalone"><h1>페이지를 찾을 수 없어요</h1><Link className="button primary" href="/" navigate={navigate}>문제 둘러보기</Link></section>}
    </main>
    <footer className="footer"><div className="container footer-inner">
      <Link className="brand footer-brand" href="/" navigate={navigate}><span className="brand-mark"><Icon name="book" /></span>sturrl<span className="brand-period">.</span></Link>
      <span>© {new Date().getFullYear()} Sturrl</span>
      <a href="https://github.com/dorrl/Sturrl" rel="noreferrer" target="_blank">GitHub</a>
    </div></footer>
  </>
}

export default App
