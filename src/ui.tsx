import type { MouseEvent, ReactNode } from 'react'
import type { Navigate } from './model'

const paths = {
  book: <><path d="M12 7a5 5 0 0 0-5-3H3v15h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5V4h-4a5 5 0 0 0-5 3Z"/><path d="M12 7v14"/></>,
  bookmark: <path d="M6 4h12v16l-6-4-6 4V4Z"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  search: <><circle cx="10.8" cy="10.8" r="5.8"/><path d="m15 15 4 4"/></>,
  chevron: <path d="m7 10 5 5 5-5"/>,
  arrow: <path d="M19 12H5m6 6-6-6 6-6"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  x: <path d="m6 6 12 12M18 6 6 18"/>,
  star: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8L6.6 20l1-6-4.4-4.3 6.1-.9L12 3Z"/>,
  eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 16-5-5L6 21"/></>,
  share: <><path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8"/></>,
  moon: <path d="M20.5 15.2A8.6 8.6 0 0 1 8.8 3.5a8.6 8.6 0 1 0 11.7 11.7Z"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19m0-14-1.5 1.5m-11 11L5 19"/></>,
  filter: <><path d="M3 7h18M3 17h18"/><circle cx="8" cy="7" r="2" className="icon-knob"/><circle cx="15" cy="17" r="2" className="icon-knob"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/></>,
}

export function Icon({ name, filled = false }: { name: keyof typeof paths; filled?: boolean }) {
  return <svg className="icon" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export function Link({ href, navigate, className, children, current }: {
  href: string
  navigate: Navigate
  className?: string
  children: ReactNode
  current?: boolean
}) {
  function activate(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    navigate(href)
  }
  return <a href={href} className={className} aria-current={current ? 'page' : undefined} onClick={activate}>{children}</a>
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="notice" role="alert">{children}</p>
}
