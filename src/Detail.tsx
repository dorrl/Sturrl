import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Composer } from './Composer'
import { api, date, errorMessage, jsonRequest, levels, number, type Detail, type Navigate, type Problem, type Viewer } from './model'
import { Icon, Link, Notice } from './ui'

type AnswerResult = Pick<Problem, 'attempts' | 'correctSubmissions' | 'solvedCount'> & {
  correct: boolean
  explanation?: string
  error?: string
  viewer?: Viewer
}
type ReviewResult = Pick<Problem, 'reviewCount' | 'averageRating'> & { viewer: Viewer }

function Gallery({ photos }: { photos: string[] }) {
  const [index, setIndex] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  return <>
    <div className="gallery">{photos.map((photo, position) => <button className="gallery-thumb" type="button" key={position} onClick={() => {
      setIndex(position)
      dialog.current?.showModal()
    }}><img src={photo} alt={'문제 사진 ' + (position + 1) + ' 확대'} loading="lazy" /></button>)}</div>
    <dialog className="gallery-dialog" ref={dialog} aria-label="문제 사진 보기" onKeyDown={(event) => {
      if (event.key === 'ArrowLeft') setIndex((current) => Math.max(0, current - 1))
      if (event.key === 'ArrowRight') setIndex((current) => Math.min(photos.length - 1, current + 1))
    }}>
      <div className="gallery-controls"><span>사진 {index + 1} / {photos.length}</span><button className="icon-button" type="button" aria-label="사진 닫기" onClick={() => dialog.current?.close()}><Icon name="x" /></button></div>
      <img src={photos[index]} alt={'문제 사진 ' + (index + 1)} />
      {photos.length > 1 && <div className="gallery-controls gallery-navigation"><button className="button secondary" type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>이전 사진</button><button className="button secondary" type="button" disabled={index === photos.length - 1} onClick={() => setIndex(index + 1)}>다음 사진</button></div>}
    </dialog>
  </>
}

function Review({ detail, endpoint, onReview }: { detail: Detail; endpoint: string; onReview: (result: ReviewResult) => void }) {
  const { item, viewer } = detail
  const [draft, setDraft] = useState<number | null>(viewer.rating)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  async function save(rating: number | null) {
    setBusy(true)
    setNotice('')
    setError('')
    try {
      const result = await api<ReviewResult>(endpoint + '/review', jsonRequest('PUT', { rating }))
      onReview(result)
      setDraft(result.viewer.rating)
      setNotice(rating === null ? '별점을 지웠어요.' : '별점을 저장했어요.')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  return <section className="panel review-panel" aria-labelledby="review-title">
    <h2 id="review-title">풀이 리뷰</h2>
    <div className="review-score"><Icon name="star" filled /><b>{item.averageRating === null ? '–' : item.averageRating.toFixed(1)}</b><span>별점 {number.format(item.reviewCount)}개</span></div>
    {viewer.solved ? <form onSubmit={(event) => { event.preventDefault(); if (draft !== null && !busy) void save(draft) }}>
      <fieldset className="review-stars" disabled={busy}><legend>이 문제는 어땠나요?</legend><div>{levels.map((rating) => <label className={draft !== null && draft >= rating ? 'lit' : undefined} key={rating}>
        <input type="radio" name="rating" value={rating} checked={draft === rating} onChange={() => setDraft(rating)} aria-label={rating + '점'} />
        <Icon name="star" filled={draft !== null && draft >= rating} />
      </label>)}</div></fieldset>
      <div className="review-actions"><button className="button secondary" type="submit" disabled={busy || draft === null || draft === viewer.rating}>{busy ? '저장 중…' : '별점 저장'}</button>
        {viewer.rating !== null && <button className="text-button" type="button" disabled={busy} onClick={() => void save(null)}>지우기</button>}</div>
      {notice && <p className="status" role="status">{notice}</p>}
      {error && <Notice>{error}</Notice>}
    </form> : <p className="hint"><Icon name="lock" /> 정답을 맞히면 별점을 남길 수 있어요.</p>}
  </section>
}

export function DetailPage({ id, navigate, back, bookmarks, toggleBookmark }: {
  id: string
  navigate: Navigate
  back: string
  bookmarks: string[]
  toggleBookmark: (id: string) => void
}) {
  const endpoint = '/problems/' + id
  const [detail, setDetail] = useState<Detail>()
  const [loadError, setLoadError] = useState('')
  const [revision, setRevision] = useState(0)
  const [explanation, setExplanation] = useState<string>()
  const [answer, setAnswer] = useState('')
  const [answerError, setAnswerError] = useState('')
  const [answering, setAnswering] = useState(false)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [shareStatus, setShareStatus] = useState('')
  const [showShareUrl, setShowShareUrl] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void api<Detail>(endpoint, { signal: controller.signal }).then((result) => {
        if (!controller.signal.aborted) setDetail(result)
      }).catch((cause) => {
        if (!controller.signal.aborted) setLoadError(errorMessage(cause))
      })
    }, 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [endpoint, revision])

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (answering || !answer.trim()) return
    setAnswering(true)
    setAnswerError('')
    try {
      const result = await api<AnswerResult>(endpoint + '/answer', jsonRequest('POST', { answer }))
      setDetail((current) => current && {
        item: { ...current.item, attempts: result.attempts, correctSubmissions: result.correctSubmissions, solvedCount: result.solvedCount },
        viewer: result.viewer ?? current.viewer,
      })
      if (result.correct) setExplanation(result.explanation ?? '')
      else setAnswerError(result.error ?? '정답이 아니에요.')
    } catch (cause) { setAnswerError(errorMessage(cause)) }
    finally { setAnswering(false) }
  }

  async function deleteProblem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail || deleteBusy) return
    const password = new FormData(event.currentTarget).get('password')
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await api(endpoint, jsonRequest('DELETE', { managementPassword: password }))
      if (bookmarks.includes(detail.item.id)) toggleBookmark(detail.item.id)
      navigate(back)
    } catch (cause) { setDeleteError(errorMessage(cause)) }
    finally { setDeleteBusy(false) }
  }

  async function shareProblem() {
    const url = window.location.origin + window.location.pathname
    try {
      await navigator.clipboard.writeText(url)
      setShowShareUrl(false)
      setShareStatus('문제 링크를 복사했어요.')
    } catch {
      setShowShareUrl(true)
      setShareStatus('아래 주소를 복사해 공유할 수 있어요.')
    }
  }

  if (!detail) return <div className="route">
    <Link className="back-link" href={back} navigate={navigate}><Icon name="arrow" /> 목록으로</Link>
    <div className="empty">{loadError ? <><Notice>{loadError}</Notice><button className="button secondary" type="button" onClick={() => { setLoadError(''); setRevision(revision + 1) }}>다시 시도</button></> : <p role="status">문제를 불러오고 있어요.</p>}</div>
  </div>

  const { item, viewer } = detail
  const saved = bookmarks.includes(item.id)
  if (editing) return <Composer problem={item} navigate={navigate} back={back} onCancel={() => setEditing(false)} onSaved={(result) => {
    setDetail(result); setEditing(false); setAnswer(''); setAnswerError(''); setExplanation(undefined)
  }} />

  return <div className="route detail-route">
    <Link className="back-link" href={back} navigate={navigate}><Icon name="arrow" /> 목록으로</Link>
    <div className="detail-layout">
      <div className="detail-main">
        <article className="panel detail-problem">
          <div className="detail-top"><span className="subject-tag" data-subject={item.subject}>{item.subject}</span><span>{item.grade}</span><span>난이도 {item.difficulty}/5</span>
            {viewer.solved && <span className="solved-tag"><Icon name="check" /> 풀이 완료</span>}</div>
          <h1>{item.title}</h1>
          <div className="detail-byline"><b>{item.author}</b><time dateTime={item.createdAt}>{date.format(new Date(item.createdAt))}</time></div>
          {item.description && <p className="problem-text">{item.description}</p>}
          {!!item.photos?.length && <Gallery photos={item.photos} />}
          <div className="detail-actions">
            <button className={'button secondary' + (saved ? ' is-saved' : '')} type="button" aria-label="보관함에 저장" aria-pressed={saved} onClick={() => toggleBookmark(item.id)}><Icon name="bookmark" filled={saved} /> {saved ? '저장됨' : '저장'}</button>
            <button className="button secondary" type="button" onClick={() => void shareProblem()}><Icon name="share" /> 링크 복사</button>
          </div>
          {shareStatus && <p className="status" role="status">{shareStatus}</p>}
          {showShareUrl && <input className="share-url" aria-label="공유할 문제 주소" value={window.location.origin + window.location.pathname} onFocus={(event) => event.currentTarget.select()} readOnly />}
        </article>
        <section className={'panel answer-panel' + (explanation !== undefined ? ' answered' : '')} aria-labelledby="answer-title">
          {explanation !== undefined ? <><h2 id="answer-title" role="status"><Icon name="check" /> 정답이에요!</h2><p className="problem-text">{explanation || '등록된 해설이 없어요.'}</p></>
            : <><h2 id="answer-title"><Icon name="lock" /> 정답 제출</h2><p>{viewer.solved ? '정답을 다시 입력하면 해설을 볼 수 있어요.' : '정답을 맞히면 출제자가 남긴 해설이 열려요.'}</p>
              <form onSubmit={submitAnswer}><div className="answer-entry"><input aria-label="정답" value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={200} required autoComplete="off" placeholder="정답을 입력하세요" /><button className="button primary" type="submit" disabled={answering || !answer.trim()}>{answering ? '확인 중…' : '정답 확인'}</button></div>
                {answerError && <Notice>{answerError}</Notice>}</form>
            </>}
        </section>
      </div>
      <aside className="detail-side">
        <Review detail={detail} endpoint={endpoint} onReview={({ viewer, reviewCount, averageRating }) => {
          setDetail((current) => current && { viewer, item: { ...current.item, reviewCount, averageRating } })
        }} />
        <section className="panel stats-panel"><h2>풀이 현황</h2><dl>
          <div><dt>조회</dt><dd>{number.format(item.views)}</dd></div><div><dt>풀이자</dt><dd>{number.format(item.solvedCount)}</dd></div><div><dt>정답 제출</dt><dd>{number.format(item.correctSubmissions)}</dd></div><div><dt>전체 제출</dt><dd>{number.format(item.attempts)}</dd></div>
        </dl></section>
        <details className="panel manage-panel">
          <summary>문제 관리 <Icon name="chevron" /></summary>
          <div className="manage-actions"><button className="button secondary" type="button" disabled={answering || deleteBusy} onClick={() => { setEditing(true); window.scrollTo({ top: 0, behavior: 'instant' }) }}>수정</button>
            <button className="button danger" type="button" disabled={answering || deleteBusy} onClick={() => { setDeleting(!deleting); setDeleteError('') }} aria-expanded={deleting}>삭제</button></div>
          {deleting && <form className="delete-form" onSubmit={deleteProblem}><p>삭제하면 문제와 풀이 리뷰가 함께 삭제돼요.</p><label>관리 암호<input name="password" required type="password" autoComplete="current-password" maxLength={256} /></label>
            {deleteError && <Notice>{deleteError}</Notice>}<button className="button danger" type="submit" disabled={deleteBusy}>{deleteBusy ? '삭제 중…' : '문제 삭제'}</button></form>}
        </details>
      </aside>
    </div>
  </div>
}
