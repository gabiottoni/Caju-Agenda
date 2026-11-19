import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

const BRAND = '#b8532a'
const INK = '#3b2a20'

function save(canvas, name) {
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = name
  a.click()
}
const fileName = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// cartaz A6 (1240×1748 px ≈ 300 dpi) para a porta, o balcão ou o espelho
async function poster(salon, link) {
  const W = 1240, H = 1748
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#fffaf4'; g.fillRect(0, 0, W, H)
  g.fillStyle = BRAND; g.fillRect(0, 0, W, 26); g.fillRect(0, H - 26, W, 26)
  g.textAlign = 'center'
  g.fillStyle = BRAND
  g.font = '600 46px system-ui, -apple-system, Segoe UI, Arial'
  g.fillText('MARQUE ONLINE', W / 2, 190)
  g.fillStyle = INK
  let size = 112
  g.font = `700 ${size}px Georgia, "Times New Roman", serif`
  while (g.measureText(salon.name).width > W - 160 && size > 60) { size -= 4; g.font = `700 ${size}px Georgia, "Times New Roman", serif` }
  g.fillText(salon.name, W / 2, 330)
  const qr = document.createElement('canvas')
  await QRCode.toCanvas(qr, link, { width: 760, margin: 1, errorCorrectionLevel: 'M', color: { dark: INK, light: '#fffaf4' } })
  g.drawImage(qr, (W - 760) / 2, 420)
  g.font = '500 44px system-ui, -apple-system, Segoe UI, Arial'
  g.fillText('Aponte a câmara do telemóvel', W / 2, 1290)
  g.fillStyle = '#7a685c'
  g.font = '400 36px system-ui, -apple-system, Segoe UI, Arial'
  g.fillText('Escolha o serviço e o horário · recebe lembrete', W / 2, 1350)
  g.fillStyle = BRAND
  g.font = '600 40px system-ui, -apple-system, Segoe UI, Arial'
  g.fillText(link.replace(/^https?:\/\//, ''), W / 2, 1500)
  if (salon.phone) { g.fillStyle = '#7a685c'; g.font = '400 36px system-ui, -apple-system, Segoe UI, Arial'; g.fillText(salon.phone, W / 2, 1570) }
  return c
}

export function QrBlock({ salon, link }) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (ref.current) QRCode.toCanvas(ref.current, link, { width: 220, margin: 1, errorCorrectionLevel: 'M', color: { dark: INK, light: '#ffffff' } }).catch(() => {})
  }, [link])

  async function downloadQr() {
    const c = document.createElement('canvas')
    await QRCode.toCanvas(c, link, { width: 1200, margin: 2, errorCorrectionLevel: 'M', color: { dark: INK, light: '#ffffff' } })
    save(c, `qr-${fileName(salon.name)}.png`)
  }
  async function downloadPoster() {
    setBusy(true)
    try { save(await poster(salon, link), `cartaz-${fileName(salon.name)}.png`) } finally { setBusy(false) }
  }

  return (
    <div className="qr-block">
      <canvas ref={ref} width={220} height={220} aria-label="QR code do link de marcação" />
      <div className="stack tight">
        <span className="small"><b>QR code</b> — para a porta, o balcão, o espelho ou cartões. A cliente aponta a câmara e abre a página de marcação.</span>
        <div className="row-actions">
          <button className="btn small" onClick={downloadPoster} disabled={busy}>{busy ? 'A preparar…' : '🖨️ Cartaz para imprimir'}</button>
          <button className="btn small ghost" onClick={downloadQr}>Só o QR (PNG)</button>
        </div>
      </div>
    </div>
  )
}
