import { useMemo, useState } from 'react'
import { sb, notify, errMsg, sameDay, fDay, fShort, fTime, googleCalUrl, waLink, bookingLabel, isoDate, fDur, fMoney, mapsLink } from './lib.js'

export function reminderText(b, salon) {
  return `Olá ${b.client_name.split(' ')[0]}! Lembrete da sua marcação de ${bookingLabel(b)} no ${salon.name}: ${fDay(b.starts_at)} às ${fTime(b.starts_at)}. Até já! 🌿`
}
const manageUrl = (b) => `${location.href.split('#')[0]}#/m/${b.manage_token}`

// firstVisit: inclui o link do Google Maps para quem vem pela primeira vez
export function confirmText(b, salon, firstVisit = false) {
  const maps = firstVisit && mapsLink(salon)
  return [
    `Olá ${b.client_name.split(' ')[0]}! A sua marcação de ${bookingLabel(b)} no ${salon.name} está confirmada para ${fDay(b.starts_at)} às ${fTime(b.starts_at)} 🌿`,
    maps && `📍 Como chegar: ${maps}`,
    `Ver, remarcar ou pôr na sua agenda: ${manageUrl(b)}`,
  ].filter(Boolean).join('\n\n')
}
export function movedText(b, salon, start) {
  return `Olá ${b.client_name.split(' ')[0]}! A sua marcação de ${bookingLabel(b)} no ${salon.name} passou para ${fDay(start)} às ${fTime(start)}. Qualquer dúvida é só dizer 🌿\n\nVer ou pôr na sua agenda: ${manageUrl(b)}`
}

// Muda o horário de uma marcação (mantém a duração). Devolve a mensagem de erro, se houver.
export async function moveBooking(b, start) {
  const dur = new Date(b.ends_at) - new Date(b.starts_at)
  const { error } = await sb.from('bookings').update({
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + dur).toISOString(),
    reminder_sent_at: null, wa_reminder_status: null, wa_reminder_error: null,
  }).eq('id', b.id)
  return error ? errMsg(error) : ''
}

export function MovedNotice({ moved, salon, onClose }) {
  if (!moved) return null
  const { b, start } = moved
  return (
    <p className="notice">
      {b.client_name} passou para {fDay(start)} às {fTime(start)}.{' '}
      {b.client_phone && <a target="_blank" rel="noreferrer" href={waLink(b.client_phone, movedText(b, salon, start))} onClick={onClose}>Avisar por WhatsApp</a>}
      {!b.client_phone && b.client_email && <a href={`mailto:${b.client_email}?subject=${encodeURIComponent('Marcação alterada')}&body=${encodeURIComponent(movedText(b, salon, start))}`} onClick={onClose}>Avisar por e-mail</a>}
      {' · '}<button className="link small" onClick={onClose}>fechar</button>
    </p>
  )
}

function MoveForm({ b, onDone, onCancel }) {
  const [date, setDate] = useState(isoDate(new Date(b.starts_at)))
  const [time, setTime] = useState(fTime(b.starts_at))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    const [y, m, d] = date.split('-').map(Number)
    const [hh, mm] = time.split(':').map(Number)
    const start = new Date(y, m - 1, d, hh, mm)
    setBusy(true)
    const e = await moveBooking(b, start)
    setBusy(false)
    if (e) return setErr(e)
    onDone(start)
  }
  return (
    <div className="stack tight move-form">
      {err && <p className="alert small">{err}</p>}
      <div className="inline-form">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Novo dia" />
        <input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Nova hora" />
        <button className="btn small primary" disabled={busy} onClick={save}>{busy ? '…' : 'Guardar'}</button>
        <button className="btn small ghost" onClick={onCancel}>×</button>
      </div>
    </div>
  )
}

export function BookingsList({ salon, bookings, items, mode, reload, openClient, openBooking }) {
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [confirmCancel, setConfirmCancel] = useState('')
  const [approved, setApproved] = useState(null) // { b, first }
  const [moving, setMoving] = useState('')
  const [moved, setMoved] = useState(null)

  async function toggleReminder(b) {
    setBusyId(b.id)
    const { error } = await sb.from('bookings').update({ wa_reminder: !b.wa_reminder }).eq('id', b.id)
    setBusyId('')
    if (error) return setError(errMsg(error))
    reload()
  }

  async function setStatus(b, status) {
    setBusyId(b.id); setError('')
    const { error } = await sb.from('bookings').update({ status, cancelled_by: status === 'cancelled' ? 'salon' : null }).eq('id', b.id)
    setBusyId(''); setConfirmCancel('')
    if (error) return setError(errMsg(error))
    notify({ event: status === 'cancelled' ? 'cancelled_by_salon' : status, booking_id: b.id })
    let first = false
    if (status === 'confirmed' && b.client_id) {
      const { count } = await sb.from('bookings').select('id', { count: 'exact', head: true })
        .eq('client_id', b.client_id).eq('status', 'confirmed').neq('id', b.id).lt('starts_at', b.starts_at)
      first = !count
    } else if (status === 'confirmed') first = true
    setApproved(status === 'confirmed' ? { b, first } : null)
    reload()
  }

  const list = items ?? bookings.filter((b) =>
    mode === 'pending'
      ? b.status === 'pending' && new Date(b.ends_at) > new Date()
      : b.status === 'confirmed' && new Date(b.ends_at) > new Date(Date.now() - 12 * 36e5),
  )
  const ab = approved?.b
  const approvedNotice = (
    <>
      {ab && (
        <p className="notice">
          Marcação de {ab.client_name} confirmada{approved.first && mapsLink(salon) ? ' (1ª visita — a mensagem leva o link do mapa)' : ''}.{' '}
          {ab.client_phone ? (
            <a target="_blank" rel="noreferrer" href={waLink(ab.client_phone, confirmText(ab, salon, approved.first))} onClick={() => setApproved(null)}>Avisar por WhatsApp</a>
          ) : ab.client_email ? (
            <a href={`mailto:${ab.client_email}?subject=${encodeURIComponent('Marcação confirmada')}&body=${encodeURIComponent(confirmText(ab, salon, approved.first))}`} onClick={() => setApproved(null)}>Avisar por e-mail</a>
          ) : null}
        </p>
      )}
      <MovedNotice moved={moved} salon={salon} onClose={() => setMoved(null)} />
    </>
  )
  if (list.length === 0) return <div className="stack">{approvedNotice}<p className="empty">{mode === 'pending' ? 'Nenhum pedido à espera. ☕' : 'Sem marcações confirmadas por agora.'}</p></div>

  const groups = []
  for (const b of list) {
    const d = new Date(b.starts_at)
    const g = groups.find((x) => sameDay(x.day, d))
    g ? g.items.push(b) : groups.push({ day: d, items: [b] })
  }

  return (
    <div className="stack">
      {error && <p className="alert">{error}</p>}
      {approvedNotice}
      {groups.map((g) => (
        <section key={g.day.toDateString()}>
          <h3 className="day-head">
            {sameDay(g.day, new Date()) ? 'Hoje' : fDay(g.day)}
            <span className="muted"> · {g.items.length}</span>
          </h3>
          <div className="stack tight">
            {g.items.map((b) => (
              <article key={b.id} className={`card booking-row ${b.status} ${openBooking ? 'clickable' : ''}`}
                role={openBooking ? 'button' : undefined} tabIndex={openBooking ? 0 : undefined}
                onClick={(e) => { if (openBooking && !e.target.closest('button, a, input, select, textarea')) openBooking(b.id) }}
                onKeyDown={(e) => { if (openBooking && e.key === 'Enter' && e.target === e.currentTarget) openBooking(b.id) }}>
                <div className="time-col">
                  <strong>{fTime(b.starts_at)}</strong>
                  <span className="muted small">{fTime(b.ends_at)}</span>
                </div>
                <div className="info-col">
                  {b.client_id && !openBooking ? (
                    <button className="link name-link" onClick={() => openClient(b.client_id)}><strong>{b.client_name}</strong></button>
                  ) : (
                    <strong>{b.client_name}</strong>
                  )}
                  <span>{bookingLabel(b)}</span>
                  <span className="muted small">
                    {b.client_phone && <a href={`tel:${b.client_phone}`}>{b.client_phone}</a>}
                    {b.client_phone && b.client_email && ' · '}
                    {b.client_email && <a href={`mailto:${b.client_email}`}>{b.client_email}</a>}
                  </span>
                  {b.notes && <span className="note">“{b.notes}”</span>}
                  {mode === 'pending' && <span className="muted small">Pedido em {fShort(b.created_at)}</span>}
                  {b.client_reply === 'confirmed' && <span className="small rem ok">✅ Cliente confirmou a presença</span>}
                  {b.client_reply === 'reschedule' && <span className="small rem bad">🔁 Cliente pediu para remarcar — fale com ela ou mude o horário</span>}
                  {(salon.wa_phone_number_id || salon.reminder_channel === 'email') && (b.client_phone || b.client_email) && <ReminderBadge b={b} salon={salon} busy={busyId === b.id} onToggle={() => toggleReminder(b)} />}
                  <div className="row-actions">
                    {mode === 'pending' ? (
                      <>
                        <button className="btn small primary" disabled={busyId === b.id} onClick={() => setStatus(b, 'confirmed')}>Aprovar</button>
                        <button className="btn small ghost" disabled={busyId === b.id} onClick={() => setStatus(b, 'declined')}>Recusar</button>
                      </>
                    ) : confirmCancel === b.id ? (
                      <>
                        <button className="btn small danger-fill" disabled={busyId === b.id} onClick={() => setStatus(b, 'cancelled')}>Confirmar cancelamento</button>
                        <button className="btn small ghost" onClick={() => setConfirmCancel('')}>Voltar</button>
                      </>
                    ) : moving === b.id ? (
                      <MoveForm b={b} onCancel={() => setMoving('')} onDone={(start) => { setMoving(''); setMoved({ b, start }); reload() }} />
                    ) : (
                      <>
                        <button className="btn small ghost" onClick={() => setMoving(b.id)}>Mudar horário</button>
                        {b.client_phone && <a className="btn small ghost" target="_blank" rel="noreferrer" href={waLink(b.client_phone, reminderText(b, salon))}>WhatsApp</a>}
                        <a className="btn small ghost" target="_blank" rel="noreferrer" href={googleCalUrl(`${bookingLabel(b)} — ${b.client_name}`, b.starts_at, b.ends_at, [b.client_phone, b.client_email, b.notes].filter(Boolean).join('\n'))}>+ Google</a>
                        <button className="btn small ghost danger" onClick={() => setConfirmCancel(b.id)}>Cancelar</button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ReminderBadge({ b, salon, busy, onToggle }) {
  if (b.wa_reminder_status === 'sent') return <span className="small rem ok">{b.reminder_channel === 'email' ? '✉️' : '📲'} Lembrete enviado ✓ {b.reminder_sent_at && fShort(b.reminder_sent_at)} {b.reminder_sent_at && fTime(b.reminder_sent_at)}</span>
  if (b.wa_reminder_status === 'failed') return <span className="small rem bad" title={b.wa_reminder_error ?? ''}>📲 Lembrete falhou — {b.wa_reminder_error}</span>
  if (b.wa_reminder_status === 'skipped') return <span className="small rem muted">📲 Lembrete não enviado ({b.wa_reminder_error})</span>
  return (
    <button type="button" className={`small rem toggle ${b.wa_reminder ? 'on' : ''}`} disabled={busy} onClick={onToggle} title="Ligar/desligar o lembrete automático desta marcação">
      📲 Lembrete {b.wa_reminder ? `automático ${salon.wa_reminder_hours} h antes` : 'desligado'}
      {b.wa_reminder && !salon.wa_reminders_enabled && ' (ative nas Definições)'}
    </button>
  )
}

// Marcação feita pela profissional (WhatsApp, telefone, balcão)
export function NewBooking({ salon, services, clients, bookings, presetClient, presetStart, onDone, onCancel }) {
  const active = services.filter((s) => s.active)
  const [clientId, setClientId] = useState(presetClient?.id ?? '')
  const [q, setQ] = useState('')
  const [isNew, setIsNew] = useState(false)
  const [nc, setNc] = useState({ name: '', phone: '', email: '' })
  const [picked, setPicked] = useState([])
  const [date, setDate] = useState(isoDate(presetStart ?? new Date()))
  const [time, setTime] = useState(presetStart ? fTime(presetStart) : '10:00')
  const [notes, setNotes] = useState('')
  const [remind, setRemind] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    const digits = t.replace(/\D/g, '')
    return clients
      .filter((c) => c.name.toLowerCase().includes(t) || (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits)) || (c.email ?? '').toLowerCase().includes(t))
      .slice(0, 8)
  }, [q, clients])

  const client = clients.find((c) => c.id === clientId) ?? presetClient
  const chosen = picked.map((id) => active.find((s) => s.id === id)).filter(Boolean)
  const dur = chosen.reduce((a, s) => a + s.duration_min, 0)
  const total = chosen.reduce((a, s) => a + (s.price_cents ?? 0), 0)

  const [y, mo, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const start = new Date(y, mo - 1, d, hh, mm)
  const end = new Date(start.getTime() + dur * 6e4)
  const clash = dur > 0 && bookings.find((b) => ['pending', 'confirmed'].includes(b.status) && new Date(b.starts_at) < end && new Date(b.ends_at) > start)

  async function save(e) {
    e.preventDefault()
    setError('')
    if (!chosen.length) return setError('Escolha pelo menos um serviço.')
    if (!client && !isNew) return setError('Escolha a cliente ou crie uma nova.')
    setBusy(true)
    let c = client
    if (isNew) {
      const { data, error } = await sb
        .from('clients')
        .insert({ salon_id: salon.id, name: nc.name.trim(), phone: nc.phone.trim() || null, email: nc.email.trim().toLowerCase() || null, source: 'salon' })
        .select('*')
        .single()
      if (error) { setBusy(false); return setError(errMsg(error)) }
      c = data
    }
    const items = chosen.map((s) => ({ id: s.id, name: s.name, duration_min: s.duration_min, price_cents: s.price_cents }))
    const { error } = await sb.from('bookings').insert({
      salon_id: salon.id,
      client_id: c.id,
      client_name: c.name,
      client_phone: c.phone,
      client_email: c.email,
      service_id: chosen[0].id,
      service_name: chosen.map((s) => s.name).join(' + '),
      services: items,
      notes: notes.trim() || null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      status: 'confirmed',
      source: 'salon',
      wa_reminder: remind,
    })
    setBusy(false)
    if (error) return setError(errMsg(error))
    onDone()
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h3>Nova marcação</h3>
      {error && <p className="alert">{error}</p>}

      {client && !isNew ? (
        <div className="picked-client">
          <strong>{client.name}</strong>
          <span className="muted small">{[client.phone, client.email].filter(Boolean).join(' · ')}</span>
          {!presetClient && <button type="button" className="link small" onClick={() => setClientId('')}>trocar</button>}
        </div>
      ) : isNew ? (
        <div className="stack tight">
          <label>Nome<input required minLength={1} maxLength={80} value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} /></label>
          <div className="two">
            <label>Telemóvel<input type="tel" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} /></label>
            <label>E-mail<input type="email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} /></label>
          </div>
          <button type="button" className="link small" onClick={() => setIsNew(false)}>← procurar cliente existente</button>
        </div>
      ) : (
        <div className="stack tight">
          <label>Cliente<input placeholder="Nome, telemóvel ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></label>
          {matches.map((c) => (
            <button type="button" key={c.id} className="pick-row" onClick={() => { setClientId(c.id); setQ('') }}>
              <strong>{c.name}</strong> <span className="muted small">{c.phone ?? c.email ?? ''}</span>
            </button>
          ))}
          <button type="button" className="link small" onClick={() => { setIsNew(true); setNc({ ...nc, name: q }) }}>+ Nova cliente</button>
        </div>
      )}

      <div className="stack tight">
        <span className="small muted">Serviços</span>
        <div className="chips">
          {active.map((s) => (
            <button type="button" key={s.id} className={`chip pick ${picked.includes(s.id) ? 'on' : ''}`} onClick={() => setPicked((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))}>
              {s.name}
            </button>
          ))}
        </div>
        {chosen.length > 0 && <span className="small muted">{fDur(dur)} · {fMoney(total)}</span>}
      </div>

      <div className="two">
        <label>Dia<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Hora<input type="time" required step={300} value={time} onChange={(e) => setTime(e.target.value)} /></label>
      </div>
      {clash && <p className="notice small">Atenção: sobrepõe-se a {clash.client_name} ({fTime(clash.starts_at)}–{fTime(clash.ends_at)}).</p>}
      <label>Notas <span className="muted">(opcional)</span><textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      {salon.wa_phone_number_id && (
        <label className="check"><input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} /> Enviar lembrete automático por WhatsApp {salon.wa_reminder_hours} h antes</label>
      )}
      <div className="row-actions">
        <button className="btn primary" disabled={busy}>{busy ? 'A guardar…' : 'Guardar marcação'}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  )
}
