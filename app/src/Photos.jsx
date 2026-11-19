import { useEffect, useState } from 'react'
import { sb } from './lib.js'

const BUCKET = 'service-photos'
export const MAX_PHOTOS = 4

// reduz no telemóvel antes de enviar (máx. 1400 px, JPEG ~80%)
async function shrink(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null)
  if (!bmp) throw new Error('Não consegui ler esta imagem. Use uma foto JPG ou PNG.')
  const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
  return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8))
}
const pathOf = (url) => decodeURIComponent(url.split(`/${BUCKET}/`)[1] ?? '')

export async function deletePhotos(urls) {
  const paths = urls.map(pathOf).filter(Boolean)
  if (paths.length) await sb.storage.from(BUCKET).remove(paths)
}

// editor usado no formulário do serviço
export function PhotoEditor({ salonId, value, onChange }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function add(e) {
    const files = [...(e.target.files ?? [])].slice(0, MAX_PHOTOS - value.length)
    e.target.value = ''
    if (!files.length) return
    setBusy(true); setErr('')
    const out = [...value]
    try {
      for (const f of files) {
        const blob = await shrink(f)
        const path = `${salonId}/${crypto.randomUUID()}.jpg`
        const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
        if (error) throw error
        out.push(sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
      }
    } catch (e2) { setErr(e2.message ?? String(e2)) }
    setBusy(false); onChange(out)
  }
  const move = (i, d) => { const l = [...value]; [l[i], l[i + d]] = [l[i + d], l[i]]; onChange(l) }
  return (
    <div className="stack tight">
      <span className="small">Fotos <span className="muted">(até {MAX_PHOTOS} — a primeira é a capa)</span></span>
      <div className="photo-edit">
        {value.map((u, i) => (
          <div key={u} className="photo-tile">
            <img src={u} alt={`Foto ${i + 1}`} />
            <div className="photo-tools">
              {i > 0 && <button type="button" aria-label="Mover para a esquerda" onClick={() => move(i, -1)}>‹</button>}
              <button type="button" aria-label="Remover foto" onClick={() => onChange(value.filter((x) => x !== u))}>×</button>
              {i < value.length - 1 && <button type="button" aria-label="Mover para a direita" onClick={() => move(i, 1)}>›</button>}
            </div>
          </div>
        ))}
        {value.length < MAX_PHOTOS && (
          <label className={`photo-add ${busy ? 'busy' : ''}`}>
            <input type="file" accept="image/*" multiple onChange={add} disabled={busy} hidden />
            <span>{busy ? 'A enviar…' : '+ Foto'}</span>
          </label>
        )}
      </div>
      {err && <p className="alert small">{err}</p>}
      <p className="muted small">Mostre o resultado (antes/depois). Use fotos suas e, se aparecer o rosto de uma cliente, peça-lhe autorização.</p>
    </div>
  )
}

// galeria em ecrã inteiro
export function Lightbox({ photos, start = 0, title, onClose }) {
  const [i, setI] = useState(start)
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') setI((x) => Math.min(photos.length - 1, x + 1)); if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1)) }
    document.addEventListener('keydown', k); document.body.classList.add('no-scroll')
    return () => { document.removeEventListener('keydown', k); document.body.classList.remove('no-scroll') }
  }, [photos.length, onClose])
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <button className="lb-x" aria-label="Fechar" onClick={onClose}>×</button>
      <img src={photos[i]} alt={`${title} — foto ${i + 1}`} />
      {photos.length > 1 && <>
        <button className="lb-nav prev" aria-label="Anterior" disabled={i === 0} onClick={() => setI(i - 1)}>‹</button>
        <button className="lb-nav next" aria-label="Seguinte" disabled={i === photos.length - 1} onClick={() => setI(i + 1)}>›</button>
        <div className="lb-dots">{photos.map((_, j) => <span key={j} className={j === i ? 'on' : ''} />)}</div>
      </>}
      <p className="lb-title">{title}</p>
    </div>
  )
}
