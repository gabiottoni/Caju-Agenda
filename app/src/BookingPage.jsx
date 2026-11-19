import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import SlotPicker from './SlotPicker.jsx'
import { Lightbox } from './Photos.jsx'
import { sb, notify, errMsg, fDayTime, fMoney, fDur, validEmail, validPhone } from './lib.js'

const STEPS = [
  ['service', 'Serviços'],
  ['time', 'Horário'],
  ['details', 'Dados'],
]

export default function BookingPage() {
  const { slug = '' } = useParams()
  const [salon, setSalon] = useState(undefined)
  const [step, setStep] = useState('service')
  const [picked, setPicked] = useState([]) // ids pela ordem escolhida
  const [gallery, setGallery] = useState(null) // serviço com as fotos abertas
  const [time, setTime] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [token, setToken] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    sb.rpc('get_public_salon', { p_slug: slug }).then(({ data }) => {
      setSalon(data ?? null)
      if (data) document.title = `Marcar — ${data.name}`
    })
  }, [slug])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('cliente') ?? 'null')
      if (saved) setForm((f) => ({ ...f, ...saved, notes: '' }))
    } catch {}
  }, [])

  if (salon === undefined) return <div className="page center"><p className="muted">A carregar…</p></div>
  if (salon === null)
    return (
      <div className="page center">
        <h1>Salão não encontrado</h1>
        <p className="muted">Confirme o link que recebeu.</p>
      </div>
    )

  const chosen = picked.map((id) => salon.services.find((s) => s.id === id)).filter(Boolean)
  const totalMin = chosen.reduce((a, s) => a + s.duration_min, 0)
  const totalCents = chosen.some((s) => s.price_cents == null) ? null : chosen.reduce((a, s) => a + s.price_cents, 0)
  const names = chosen.map((s) => s.name).join(' + ')

  function toggle(id) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
    setTime(null)
    setError('')
  }

  async function submit(e) {
    e.preventDefault()
    if (!chosen.length || !time) return
    const email = form.email.trim()
    const phone = form.phone.trim()
    if (!email && !phone) return setError('Indique o telemóvel ou o e-mail para podermos confirmar.')
    if (phone && !validPhone(phone)) return setError('O telemóvel parece incompleto.')
    if (email && !validEmail(email)) return setError('O e-mail parece inválido.')
    setSending(true)
    setError('')
    const { data, error } = await sb.rpc('create_booking', {
      p_slug: salon.slug,
      p_service_ids: picked,
      p_starts_at: time.toISOString(),
      p_name: form.name,
      p_email: email || null,
      p_phone: phone || null,
      p_notes: form.notes || null,
    })
    setSending(false)
    if (error) {
      setError(errMsg(error))
      if (error.message.includes('ocupado') || error.message.includes('disponível')) {
        setTime(null)
        setRefresh((n) => n + 1)
        setStep('time')
      }
      return
    }
    try {
      localStorage.setItem('cliente', JSON.stringify({ name: form.name, email, phone }))
    } catch {}
    notify({ event: 'requested', token: data.manage_token })
    setToken(data.manage_token)
    setStep('done')
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  return (
    <div className="page booking">
      <header className="brand-head">
        <p className="eyebrow">Marcação online</p>
        <h1>{salon.name}</h1>
        {salon.address && <p className="muted small">{salon.address}</p>}
      </header>

      {step !== 'done' && (
        <ol className="steps" aria-label="Passos">
          {STEPS.map(([k, label], i) => (
            <li key={k} className={step === k ? 'on' : ''}>
              {i + 1}. {label}
            </li>
          ))}
        </ol>
      )}

      {error && <p className="alert" role="alert">{error}</p>}

      {step === 'service' && (
        <section className="stack">
          {salon.services.length === 0 && <p className="muted">Ainda não há serviços disponíveis.</p>}
          {salon.services.length > 0 && <p className="muted small">Pode escolher mais do que um serviço.</p>}
          {salon.services.map((s) => {
            const on = picked.includes(s.id)
            return (
              <div key={s.id} className="service-wrap">
              <button type="button" className={`card service-card ${on ? 'picked' : ''} ${s.photos?.length ? 'has-photo' : ''}`} aria-pressed={on} onClick={() => toggle(s.id)}>
                {s.photos?.length > 0 ? <img className="svc-cover" src={s.photos[0]} alt="" loading="lazy" /> : null}
                <span className="tick" aria-hidden="true">{on ? '✓' : ''}</span>
                <span className="grow">
                  <strong>{s.name}</strong>
                  {s.description && <span className="muted small block">{s.description}</span>}
                </span>
                <span className="service-meta">
                  <span>{fMoney(s.price_cents)}</span>
                  <span className="muted small">{fDur(s.duration_min)}</span>
                </span>
              </button>
              {s.photos?.length > 0 && (
                <button type="button" className="svc-photos-btn" onClick={() => setGallery(s)}>📷 {s.photos.length === 1 ? 'Ver' : `${s.photos.length} fotos`}</button>
              )}
              </div>
            )
          })}
          {chosen.length > 0 && (
            <button className="btn primary big sticky" onClick={() => { setStep('time'); setError('') }}>
              Continuar · {chosen.length} {chosen.length === 1 ? 'serviço' : 'serviços'} · {fDur(totalMin)}
              {totalCents != null && ` · ${fMoney(totalCents)}`}
            </button>
          )}
        </section>
      )}

      {step === 'time' && chosen.length > 0 && (
        <section>
          <button className="link back" onClick={() => setStep('service')}>← {names}</button>
          <SlotPicker salon={salon} durationMin={totalMin} selected={time} refreshKey={refresh} onSelect={(t) => { setTime(t); setStep('details'); setError('') }} />
        </section>
      )}

      {step === 'details' && chosen.length > 0 && time && (
        <form className="stack" onSubmit={submit}>
          <button type="button" className="link back" onClick={() => setStep('time')}>← Mudar horário</button>
          <div className="card summary">
            <strong>{names}</strong>
            <span>{fDayTime(time)}</span>
            <span className="muted small">
              {fDur(totalMin)}
              {totalCents != null && ` · ${fMoney(totalCents)}`}
            </span>
          </div>
          <label>
            Nome
            <input required minLength={2} maxLength={80} autoComplete="name" value={form.name} onChange={set('name')} />
          </label>
          <label>
            Telemóvel
            <input type="tel" autoComplete="tel" inputMode="tel" placeholder="912 345 678" value={form.phone} onChange={set('phone')} />
          </label>
          <label>
            E-mail
            <input type="email" autoComplete="email" value={form.email} onChange={set('email')} />
          </label>
          <p className="muted small" style={{ marginTop: -6 }}>Preencha pelo menos um dos dois (telemóvel ou e-mail).</p>
          <label>
            Observações <span className="muted">(opcional)</span>
            <textarea maxLength={500} rows={2} value={form.notes} onChange={set('notes')} />
          </label>
          <button className="btn primary big" disabled={sending}>{sending ? 'A enviar…' : 'Pedir marcação'}</button>
          <p className="muted small legal-note">Os seus dados servem só para gerir esta marcação e enviar-lhe o lembrete. <a href="privacidade.html" target="_blank" rel="noreferrer">Política de privacidade</a></p>
          <p className="muted small center-text">O horário fica reservado e {salon.name} confirma consigo.</p>
        </form>
      )}

      {step === 'done' && chosen.length > 0 && time && (
        <section className="stack center-text">
          <div className="done-mark" aria-hidden="true">✓</div>
          <h2>Pedido enviado!</h2>
          <p>
            <strong>{names}</strong>
            <br />
            {fDayTime(time)}
          </p>
          <p className="muted">
            {salon.name} vai confirmar {form.phone ? 'pelo telemóvel' : 'por e-mail'}. Guarde o link abaixo para ver, remarcar ou cancelar.
          </p>
          <a className="btn" href={`#/m/${token}`}>Ver ou alterar marcação</a>
          <button className="link" onClick={() => { setStep('service'); setPicked([]); setTime(null); setRefresh((n) => n + 1) }}>
            Fazer outra marcação
          </button>
        </section>
      )}

      {gallery && <Lightbox photos={gallery.photos} title={gallery.name} onClose={() => setGallery(null)} />}
      <footer className="foot">
        {salon.phone && <a href={`tel:${salon.phone}`}>{salon.phone}</a>}
        <span className="legal-links"><a href="privacidade.html">Privacidade</a> · <a href="termos.html">Termos</a></span>
      </footer>
    </div>
  )
}
