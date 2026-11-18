import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import SlotPicker from './SlotPicker.jsx'
import { sb, notify, errMsg, fDayTime, googleCalUrl, bookingLabel, clientIcsUrl, mapsLink } from './lib.js'

const STATUS = {
  pending: ['A aguardar confirmação', 'pending'],
  confirmed: ['Confirmada', 'ok'],
  declined: ['Não confirmada', 'off'],
  cancelled: ['Cancelada', 'off'],
}

export default function ManagePage() {
  const { token = '' } = useParams()
  const [bk, setBk] = useState(undefined)
  const [salon, setSalon] = useState(null)
  const [mode, setMode] = useState('view')
  const [time, setTime] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    const { data } = await sb.rpc('get_booking_by_token', { p_token: token })
    setBk(data ?? null)
    if (data) {
      const { data: s } = await sb.rpc('get_public_salon', { p_slug: data.salon_slug })
      setSalon(s)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  if (bk === undefined) return <div className="page center"><p className="muted">A carregar…</p></div>
  if (bk === null)
    return (
      <div className="page center">
        <h1>Marcação não encontrada</h1>
        <p className="muted">Confirme o link que recebeu.</p>
      </div>
    )

  const active = bk.status === 'pending' || bk.status === 'confirmed'
  const locked = bk.status === 'confirmed' && new Date(bk.starts_at).getTime() < Date.now() + bk.cancel_limit_hours * 36e5
  const durMin = (new Date(bk.ends_at) - new Date(bk.starts_at)) / 6e4
  const [label, cls] = STATUS[bk.status]
  const name = bookingLabel(bk)

  async function cancel() {
    setBusy(true); setError('')
    const { error } = await sb.rpc('cancel_booking_by_token', { p_token: token })
    setBusy(false)
    if (error) return setError(errMsg(error))
    notify({ event: 'cancelled', token })
    setNotice('Marcação cancelada.'); setMode('view'); load()
  }

  async function reschedule() {
    if (!time) return
    setBusy(true); setError('')
    const { error } = await sb.rpc('reschedule_booking_by_token', { p_token: token, p_starts_at: time.toISOString() })
    setBusy(false)
    if (error) return setError(errMsg(error))
    notify({ event: 'rescheduled', token })
    setNotice('Pedido de remarcação enviado. O salão vai confirmar consigo.'); setMode('view'); setTime(null); load()
  }

  return (
    <div className="page booking">
      <header className="brand-head">
        <p className="eyebrow">A sua marcação</p>
        <h1>{bk.salon_name}</h1>
      </header>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="card summary">
        <span className={`badge ${cls}`}>{label}</span>
        <strong>{name}</strong>
        <span>{fDayTime(bk.starts_at)}</span>
        {bk.salon_address && (
          <a className="small" target="_blank" rel="noreferrer" href={mapsLink({ address: bk.salon_address, maps_url: salon?.maps_url })}>📍 {bk.salon_address}</a>
        )}
      </div>

      {mode === 'view' && active && (
        <div className="stack">
          <div className="cal-add">
            <span className="small muted">Pôr na minha agenda com lembrete:</span>
            <div className="row-actions">
              <a className="btn small" href={clientIcsUrl(token)}>📅 iPhone / Outlook</a>
              <a className="btn small" target="_blank" rel="noreferrer" href={googleCalUrl(`${name} · ${bk.salon_name}`, bk.starts_at, bk.ends_at, location.href, bk.salon_address ?? '')}>Google Agenda</a>
            </div>
          </div>
          {locked ? (
            <p className="muted small center-text">
              Alterações online só até {bk.cancel_limit_hours} h antes.
              {bk.salon_phone && <> Contacte <a href={`tel:${bk.salon_phone}`}>{bk.salon_phone}</a>.</>}
            </p>
          ) : (
            <>
              <button className="btn" onClick={() => { setMode('reschedule'); setNotice('') }}>Remarcar</button>
              <button className="btn ghost danger" onClick={() => { setMode('cancel'); setNotice('') }}>Cancelar marcação</button>
            </>
          )}
        </div>
      )}
      {mode === 'view' && !active && <a className="btn primary" href={`#/s/${bk.salon_slug}`}>Fazer nova marcação</a>}

      {mode === 'cancel' && (
        <div className="stack">
          <p>Tem a certeza que quer cancelar?</p>
          <button className="btn primary danger-fill" disabled={busy} onClick={cancel}>{busy ? 'A cancelar…' : 'Sim, cancelar'}</button>
          <button className="link" onClick={() => setMode('view')}>Voltar</button>
        </div>
      )}

      {mode === 'reschedule' && salon && (
        <div className="stack">
          <button className="link back" onClick={() => setMode('view')}>← Voltar</button>
          <SlotPicker salon={salon} durationMin={durMin} ignore={{ starts_at: bk.starts_at, ends_at: bk.ends_at }} selected={time} onSelect={setTime} />
          {time && (
            <button className="btn primary big sticky" disabled={busy} onClick={reschedule}>
              {busy ? 'A enviar…' : `Mudar para ${fDayTime(time)}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
