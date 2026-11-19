import { useEffect, useState } from 'react'
import { sb, notify, errMsg, fDay, fTime, fMoney, fDur, isoDate, waLink, googleCalUrl, bookingServices, bookingLabel } from './lib.js'
import { confirmText, movedText, reminderText } from './Bookings.jsx'

const STATUS = { pending: 'Pedido por aprovar', confirmed: 'Confirmada', cancelled: 'Cancelada', declined: 'Recusada' }
const cents = (v) => (v === '' || v == null ? null : Math.round(Number(String(v).replace(',', '.')) * 100))
const euros = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','))

// Pop-up de uma marcação: detalhes, ações e edição (serviços, duração, valor, horário)
export function BookingSheet({ salon, bookingId, services, onClose, reload, openClient }) {
  const [b, setB] = useState(null)
  const [mode, setMode] = useState('view') // view | edit | cancel | sell
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState(null) // { text, href }
  const [sales, setSales] = useState([])

  async function load() {
    const { data } = await sb.from('bookings').select('*').eq('id', bookingId).maybeSingle()
    setB(data ?? false)
    if (salon.sell_products) {
      const { data: s } = await sb.from('product_sales').select('*').eq('booking_id', bookingId).order('sold_at')
      setSales(s ?? [])
    }
  }
  useEffect(() => { setMode('view'); setNotice(null); setErr(''); load() }, [bookingId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.classList.add('no-scroll')
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll') }
  }, [onClose])

  async function setStatus(status) {
    setBusy(true); setErr('')
    const { error } = await sb.from('bookings').update({ status, cancelled_by: status === 'cancelled' ? 'salon' : null }).eq('id', b.id)
    setBusy(false)
    if (error) return setErr(errMsg(error))
    notify({ event: status === 'cancelled' ? 'cancelled_by_salon' : status, booking_id: b.id })
    if (status === 'confirmed') {
      let first = true
      if (b.client_id) {
        const { count } = await sb.from('bookings').select('id', { count: 'exact', head: true })
          .eq('client_id', b.client_id).eq('status', 'confirmed').neq('id', b.id).lt('starts_at', b.starts_at)
        first = !count
      }
      const text = confirmText(b, salon, first)
      setNotice({ text: 'Marcação confirmada.', href: b.client_phone ? waLink(b.client_phone, text) : b.client_email ? `mailto:${b.client_email}?subject=${encodeURIComponent('Marcação confirmada')}&body=${encodeURIComponent(text)}` : null })
    }
    setMode('view'); reload(); load()
  }

  const shell = (children) => (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Marcação">
        <button className="modal-x" aria-label="Fechar" onClick={onClose}>×</button>
        {children}
      </div>
    </div>
  )
  if (b === null) return shell(<p className="muted">A carregar…</p>)
  if (b === false) return shell(<p className="muted">Marcação não encontrada.</p>)

  const svc = bookingServices(b)
  const byId = new Map(services.map((s) => [s.id, s]))
  const priceOf = (s) => s.price_cents ?? (s.id ? byId.get(s.id)?.price_cents : null)
  const total = svc.reduce((a, s) => a + (priceOf(s) ?? 0), 0)
  const salesTotal = sales.reduce((a, s) => a + s.qty * s.unit_price_cents, 0)
  const dur = Math.round((new Date(b.ends_at) - new Date(b.starts_at)) / 6e4)
  const active = b.status === 'pending' || b.status === 'confirmed'

  if (mode === 'edit') {
    return shell(
      <EditForm b={b} services={services} onCancel={() => setMode('view')} onSaved={(moved) => {
        setMode('view'); reload(); load()
        if (moved) {
          const text = movedText(b, salon, moved)
          setNotice({ text: `Horário alterado para ${fDay(moved)} às ${fTime(moved)}.`, href: b.client_phone ? waLink(b.client_phone, text) : null, label: 'Avisar por WhatsApp' })
        } else setNotice({ text: 'Marcação atualizada ✓' })
      }} />,
    )
  }
  if (mode === 'sell') {
    return shell(<SellForm salon={salon} booking={b} onCancel={() => setMode('view')} onSaved={() => { setMode('view'); load() }} />)
  }

  return shell(
    <div className="stack">
      <div>
        <span className={`badge ${b.status === 'confirmed' ? 'ok' : b.status === 'pending' ? 'pending' : 'off'}`}>{STATUS[b.status] ?? b.status}</span>
        <h2 className="modal-title">
          {b.client_id ? <button className="link" onClick={() => { onClose(); openClient(b.client_id) }}>{b.client_name}</button> : b.client_name}
        </h2>
        <p className="modal-when">{fDay(b.starts_at)} · {fTime(b.starts_at)}–{fTime(b.ends_at)} <span className="muted">({fDur(dur)})</span></p>
      </div>
      {notice && (
        <p className="notice">{notice.text} {notice.href && <a target="_blank" rel="noreferrer" href={notice.href} onClick={() => setNotice(null)}>{notice.label ?? 'Avisar a cliente'}</a>}</p>
      )}
      {err && <p className="alert">{err}</p>}

      <div className="sheet-lines">
        {svc.map((s, i) => (
          <div key={i} className="rev-row">
            <span className="grow">{s.name}{s.duration_min ? <span className="muted small"> · {fDur(s.duration_min)}</span> : null}</span>
            <strong>{priceOf(s) == null ? '—' : fMoney(priceOf(s))}</strong>
          </div>
        ))}
        {sales.map((s) => (
          <div key={s.id} className="rev-row">
            <span className="grow">🛍️ {s.product_name}{s.qty > 1 ? ` × ${s.qty}` : ''}</span>
            <strong>{fMoney(s.qty * s.unit_price_cents)}</strong>
          </div>
        ))}
        <div className="rev-row total"><span className="grow">Total</span><strong>{fMoney(total + salesTotal)}</strong></div>
      </div>

      <p className="small">
        {b.client_phone && <a href={`tel:${b.client_phone}`}>📞 {b.client_phone}</a>}
        {b.client_phone && b.client_email && ' · '}
        {b.client_email && <a href={`mailto:${b.client_email}`}>{b.client_email}</a>}
      </p>
      {b.notes && <p className="note">“{b.notes}”</p>}
      {b.client_reply === 'confirmed' && <span className="small rem ok">✅ Cliente confirmou a presença</span>}
      {b.client_reply === 'reschedule' && <span className="small rem bad">🔁 Cliente pediu para remarcar</span>}
      {b.wa_reminder_status === 'sent' && <span className="small rem ok">{b.reminder_channel === 'email' ? '✉️' : '📲'} Lembrete enviado</span>}

      {mode === 'cancel' ? (
        <div className="row-actions">
          <button className="btn danger-fill" disabled={busy} onClick={() => setStatus('cancelled')}>Confirmar cancelamento</button>
          <button className="btn ghost" onClick={() => setMode('view')}>Voltar</button>
        </div>
      ) : (
        <div className="row-actions">
          {b.status === 'pending' && <>
            <button className="btn primary" disabled={busy} onClick={() => setStatus('confirmed')}>Aprovar</button>
            <button className="btn ghost" disabled={busy} onClick={() => setStatus('declined')}>Recusar</button>
          </>}
          {active && <button className="btn" onClick={() => setMode('edit')}>✏️ Editar</button>}
          {active && salon.sell_products && <button className="btn ghost" onClick={() => setMode('sell')}>🛍️ Vender produto</button>}
          {b.client_phone && <a className="btn ghost" target="_blank" rel="noreferrer" href={waLink(b.client_phone, reminderText(b, salon))}>WhatsApp</a>}
          <a className="btn ghost" target="_blank" rel="noreferrer" href={googleCalUrl(`${bookingLabel(b)} — ${b.client_name}`, b.starts_at, b.ends_at, [b.client_phone, b.client_email, b.notes].filter(Boolean).join('\n'))}>+ Google</a>
          {b.status === 'confirmed' && <button className="btn ghost danger" onClick={() => setMode('cancel')}>Cancelar</button>}
        </div>
      )}
    </div>,
  )
}

function EditForm({ b, services, onCancel, onSaved }) {
  const byId = new Map(services.map((s) => [s.id, s]))
  const [rows, setRows] = useState(() => bookingServices(b).map((s) => {
    const cat = s.id ? byId.get(s.id) : null
    return { id: s.id ?? null, name: s.name ?? cat?.name ?? '', dur: s.duration_min ?? cat?.duration_min ?? '', price: euros(s.price_cents ?? cat?.price_cents) }
  }))
  // marcações antigas sem duração por serviço: a duração total fica na primeira linha
  useEffect(() => {
    const dur = Math.round((new Date(b.ends_at) - new Date(b.starts_at)) / 6e4)
    setRows((r) => (r.every((x) => x.dur === '') ? r.map((x, i) => ({ ...x, dur: i === 0 ? dur : 0 })) : r))
  }, [b])
  const [date, setDate] = useState(isoDate(new Date(b.starts_at)))
  const [time, setTime] = useState(fTime(b.starts_at))
  const [notes, setNotes] = useState(b.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const totalDur = rows.reduce((a, r) => a + (Number(r.dur) || 0), 0)
  const totalPrice = rows.reduce((a, r) => a + (cents(r.price) ?? 0), 0)
  const set = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const pickService = (i, id) => {
    const s = byId.get(id)
    if (s) set(i, { id: s.id, name: s.name, dur: s.duration_min, price: euros(s.price_cents) })
  }

  async function save(e) {
    e.preventDefault(); setErr('')
    if (!rows.length || rows.some((r) => !r.name.trim())) return setErr('Cada linha precisa de um serviço.')
    if (totalDur <= 0) return setErr('A duração tem de ser maior que zero.')
    const [y, m, d] = date.split('-').map(Number)
    const [hh, mm] = time.split(':').map(Number)
    const start = new Date(y, m - 1, d, hh, mm)
    const end = new Date(start.getTime() + totalDur * 6e4)
    const items = rows.map((r) => ({ id: r.id, name: r.name.trim(), duration_min: Number(r.dur) || 0, price_cents: cents(r.price) }))
    const moved = start.getTime() !== new Date(b.starts_at).getTime()
    const patch = {
      services: items, service_id: items[0].id, service_name: items.map((s) => s.name).join(' + '),
      starts_at: start.toISOString(), ends_at: end.toISOString(), notes: notes.trim() || null,
    }
    if (moved) Object.assign(patch, { reminder_sent_at: null, wa_reminder_status: null, wa_reminder_error: null })
    setBusy(true)
    const { error } = await sb.from('bookings').update(patch).eq('id', b.id)
    setBusy(false)
    if (error) return setErr(errMsg(error))
    onSaved(moved ? start : null)
  }

  return (
    <form className="stack" onSubmit={save}>
      <h2 className="modal-title">Editar marcação</h2>
      <p className="muted small">{b.client_name}</p>
      {err && <p className="alert">{err}</p>}
      <div className="two">
        <label>Dia<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Hora<input type="time" required step={300} value={time} onChange={(e) => setTime(e.target.value)} /></label>
      </div>
      <div className="stack tight">
        <span className="small"><b>Serviços</b></span>
        {rows.map((r, i) => (
          <div key={i} className="svc-edit">
            <select value={r.id && byId.has(r.id) ? r.id : ''} onChange={(e) => pickService(i, e.target.value)} aria-label="Serviço">
              {!(r.id && byId.has(r.id)) && <option value="">{r.name || 'Escolher serviço…'}</option>}
              {services.filter((s) => s.active || s.id === r.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <label className="mini">Min<input type="number" min={0} step={5} inputMode="numeric" value={r.dur} onChange={(e) => set(i, { dur: e.target.value })} /></label>
            <label className="mini">€<input inputMode="decimal" placeholder="0,00" value={r.price} onChange={(e) => set(i, { price: e.target.value })} /></label>
            <button type="button" className="btn small ghost" aria-label="Remover serviço" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="link small" onClick={() => setRows([...rows, { id: null, name: '', dur: '', price: '' }])}>+ Adicionar serviço</button>
      </div>
      <p className="small">Total: <b>{fDur(totalDur)}</b> · <b>{fMoney(totalPrice)}</b> <span className="muted">· termina às {(() => { const [hh, mm] = time.split(':').map(Number); const t = hh * 60 + mm + totalDur; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` })()}</span></p>
      <p className="muted small">Mudar o valor aqui só altera esta marcação (ex.: desconto), não o preço do serviço.</p>
      <label>Notas<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="row-actions">
        <button className="btn primary" disabled={busy}>{busy ? 'A guardar…' : 'Guardar'}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Voltar</button>
      </div>
    </form>
  )
}

export function SellForm({ salon, booking, clientId, onCancel, onSaved }) {
  const [products, setProducts] = useState(null)
  const [pid, setPid] = useState('')
  const [qty, setQty] = useState(1)
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    sb.from('products').select('*').eq('salon_id', salon.id).eq('active', true).order('name').then(({ data }) => setProducts(data ?? []))
  }, [salon.id])
  const p = products?.find((x) => x.id === pid)

  async function save(e) {
    e.preventDefault(); setErr('')
    if (!p) return setErr('Escolha o produto.')
    setBusy(true)
    const { error } = await sb.from('product_sales').insert({
      salon_id: salon.id, product_id: p.id, product_name: p.name, qty: Number(qty) || 1,
      unit_price_cents: cents(price) ?? 0, unit_cost_cents: p.cost_cents,
      booking_id: booking?.id ?? null, client_id: booking?.client_id ?? clientId ?? null,
      sold_at: booking ? booking.starts_at : new Date().toISOString(),
    })
    setBusy(false)
    if (error) return setErr(errMsg(error))
    onSaved()
  }

  return (
    <form className="stack" onSubmit={save}>
      <h2 className="modal-title">Vender produto</h2>
      {booking && <p className="muted small">{booking.client_name} · {fDay(booking.starts_at)}</p>}
      {err && <p className="alert">{err}</p>}
      {products === null ? <p className="muted">A carregar…</p> : products.length === 0 ? (
        <p className="muted small">Ainda não há produtos. Adicione-os no separador <b>Produtos</b>.</p>
      ) : (
        <>
          <label>Produto
            <select required value={pid} onChange={(e) => { setPid(e.target.value); const x = products.find((y) => y.id === e.target.value); setPrice(euros(x?.price_cents)) }}>
              <option value="">Escolher…</option>
              {products.map((x) => <option key={x.id} value={x.id}>{x.name}{x.stock != null ? ` (stock: ${x.stock})` : ''}</option>)}
            </select>
          </label>
          <div className="two">
            <label>Quantidade<input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></label>
            <label>Preço unitário (€)<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          </div>
          {p && <p className="small">Total: <b>{fMoney((cents(price) ?? 0) * (Number(qty) || 1))}</b></p>}
        </>
      )}
      <div className="row-actions">
        <button className="btn primary" disabled={busy || !products?.length}>{busy ? 'A guardar…' : 'Registar venda'}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Voltar</button>
      </div>
    </form>
  )
}
