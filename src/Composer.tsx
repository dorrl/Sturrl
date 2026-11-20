import { useState, type FormEvent } from 'react'
import { api, errorMessage, grades, jsonRequest, levels, problemPath, subjects, type Detail, type Navigate, type Problem } from './model'
import { Icon, Link, Notice } from './ui'

const maxOriginal = 100 * 1024 * 1024
const maxCompressed = 4_200_000
const maxPhotos = 5

async function compressPhoto(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 올릴 수 있어요.')
  if (file.size >= maxOriginal) throw new Error('사진은 한 장에 100MB 미만이어야 해요.')
  const image = await createImageBitmap(file).catch(() => { throw new Error('이 사진을 열 수 없어요. 다른 이미지 파일을 선택해 주세요.') })
  try {
    const scale = Math.min(1, 1920 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('사진 크기를 줄이지 못했어요.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [.84, .72, .60, .48, .36]) {
      const result = canvas.toDataURL('image/webp', quality)
      if (result.length <= maxCompressed) return result
    }
    throw new Error('크기를 줄인 뒤에도 사진이 너무 커요. 더 작은 이미지를 선택해 주세요.')
  } finally { image.close() }
}

export function Composer({ navigate, back, problem, onSaved, onCancel }: {
  navigate: Navigate
  back: string
  problem?: Problem
  onSaved?: (detail: Detail) => void
  onCancel?: () => void
}) {
  const [photos, setPhotos] = useState(problem?.photos ?? [])
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [error, setError] = useState('')
  const [changeSolution, setChangeSolution] = useState(!problem)

  async function addPhotos(files: File[]) {
    if (files.length === 0 || files.length + photos.length > maxPhotos) {
      if (files.length) setPhotoError('사진은 최대 5장까지 올릴 수 있어요.')
      return
    }
    setAdding(true)
    setPhotoError('')
    try {
      const compressed: string[] = []
      for (const file of files) compressed.push(await compressPhoto(file))
      setPhotos((current) => [...current, ...compressed])
    } catch (cause) { setPhotoError(errorMessage(cause)) }
    finally { setAdding(false) }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || adding) return
    setSaving(true)
    setError('')
    const values = Object.fromEntries(new FormData(event.currentTarget))
    const changedPhotos = !problem || photos !== problem.photos ? { photos } : {}
    try {
      const detail = await api<Detail>(problem ? '/problems/' + encodeURIComponent(problem.id) : '/problems',
        jsonRequest(problem ? 'PUT' : 'POST', { ...values, difficulty: Number(values.difficulty), ...changedPhotos }))
      if (onSaved) onSaved(detail)
      else navigate(problemPath(detail.item.id))
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setSaving(false) }
  }

  return <div className="route composer-route">
    {onCancel ? <button className="back-link" type="button" onClick={onCancel}><Icon name="arrow" /> 문제로 돌아가기</button>
      : <Link className="back-link" href={back} navigate={navigate}><Icon name="arrow" /> 목록으로</Link>}
    <section className="panel composer" aria-labelledby="composer-title">
      <header className="panel-heading"><h1 id="composer-title">{problem ? '문제 수정' : '새 문제 올리기'}</h1><p>{problem ? '공개할 문제 정보와 첨부 사진을 수정할 수 있어요.' : '풀어볼 문제와 정답을 준비해 주세요. 해설은 정답을 맞힌 뒤 열려요.'}</p></header>
      <form onSubmit={save}>
        <fieldset className="form-section" disabled={saving}>
          <legend>문제 정보</legend>
          <label>제목<input name="title" defaultValue={problem?.title} required minLength={3} maxLength={120} placeholder="문제의 핵심을 담은 제목" /></label>
          <label>내용 <span className="hint">(선택)</span><textarea name="description" defaultValue={problem?.description} maxLength={5000} rows={5} placeholder="문제와 풀이에 필요한 조건을 적어 주세요." /></label>
          <div className="form-columns">
            <label>과목<select name="subject" defaultValue={problem?.subject ?? '수학'}>{subjects.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>학년<select name="grade" defaultValue={problem?.grade ?? '중1'}>{grades.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>난이도<select name="difficulty" defaultValue={problem?.difficulty ?? 3}>{levels.map((item) => <option key={item} value={item}>{item} / 5</option>)}</select></label>
          </div>
          <label>작성자<input name="author" defaultValue={problem?.author ?? '익명'} required maxLength={30} /></label>
          <div className="upload-area">
            <label className="upload-label"><span><Icon name="image" /> 문제 사진 <span className="hint">({photos.length}/{maxPhotos})</span></span>
              <input type="file" accept="image/*" multiple disabled={adding || photos.length >= maxPhotos} onChange={(event) => {
                void addPhotos(Array.from(event.currentTarget.files ?? []))
                event.currentTarget.value = ''
              }} />
            </label>
            <p className="hint">{adding ? '사진 크기를 줄이는 중이에요.' : '최대 5장, 원본은 장당 100MB 미만'}</p>
            {photoError && <Notice>{photoError}</Notice>}
            {photos.length > 0 && <div className="upload-previews">{photos.map((photo, index) => <div className="upload-preview" key={index}><img src={photo} alt={'첨부 사진 ' + (index + 1)} /><button className="icon-button" type="button" aria-label={'첨부 사진 ' + (index + 1) + ' 제거'} onClick={() => setPhotos((items) => items.filter((_, position) => position !== index))}><Icon name="x" /></button></div>)}</div>}
          </div>
        </fieldset>
        <fieldset className="form-section" disabled={saving}>
          <legend>정답과 해설</legend>
          {problem && <label className="check-label"><input type="checkbox" checked={changeSolution} onChange={(event) => setChangeSolution(event.target.checked)} /> 정답과 해설 새로 입력하기</label>}
          {changeSolution && <>
            <label>정답<input name="answer" required maxLength={200} autoComplete="off" placeholder="정답으로 인정할 표현을 입력하세요" /></label>
            <label>해설 <span className="hint">(선택)</span><textarea name="explanation" maxLength={10000} rows={4} placeholder="정답이 나오는 과정을 적어 주세요." /></label>
          </>}
        </fieldset>
        <fieldset className="form-section" disabled={saving}>
          <legend>문제 관리</legend>
          <label>관리 암호<input name="managementPassword" required minLength={problem ? 1 : 8} maxLength={256} type="password" autoComplete={problem ? 'current-password' : 'new-password'} placeholder={problem ? '문제를 올릴 때 정한 관리 암호' : '8자 이상'} /></label>
          <p className="hint">{problem ? '운영자 암호로도 수정할 수 있어요.' : '문제를 수정하거나 삭제할 때 이 암호가 필요해요.'}</p>
        </fieldset>
        {error && <Notice>{error}</Notice>}
        <div className="form-actions">
          {onCancel ? <button className="button secondary" type="button" onClick={onCancel} disabled={saving}>취소</button>
            : <Link className="button secondary" href={back} navigate={navigate}>취소</Link>}
          <button className="button primary" type="submit" disabled={saving || adding}>{saving ? '저장 중…' : problem ? '수정 저장' : '문제 올리기'}</button>
        </div>
      </form>
    </section>
  </div>
}
