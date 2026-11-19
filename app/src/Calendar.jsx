import { useEffect, useMemo, useRef, useState } from 'react'
import { sb, addDays, startOfDay, sameDay as sameDayD, fTime, fDay, toMin, bookingLabel, pad } from './lib.js'
import { BookingsList, moveBooking, MovedNotice } from './Bookings.jsx'
import './calendar.css'

const VIEWS = [
  ['list', 'Lista'],
  ['day', 'Dia'],
  ['week', 'Semana'],
  ['month', 'Mês'],
]
const WD_MON = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
const fmt = (o) => new Intl.DateTimeFormat('pt-PT', o)
const sameDay = (a, b) => sameDayD(new Date(a), new Date(b))
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

const startOfWeek = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7)) // semana começa à segunda
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1)

let lastCursor = null // mantém o dia/semana/mês ao abrir e fechar "Nova marcação"

function readView() {
  try { return localStorage.getItem('caju.agendaView') || 'day' } catch { return 'day' }
}
function saveView(v) {
  try { localStorage.setItem('caju.agendaView', v) } catch { /* sem armazenamento */ }
}

function rangeFor(view, cursor) {
  if (view === 'day') { const a = startOfDay(cursor); return [a, addDays(a, 1)] }
  if (view === 'week') { const a = startOfWeek(cursor); return [a, addDays(a, 7)] }
  const first = startOfMonth(cursor)
  const a = startOfWeek(first)
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
  const z = addDays(startOfWeek(last), 7)
  return [a, z]
}

function title(view, cursor) {
  if (view === 'day') return cap(fDay(cursor))
  if (view === 'week') {
    const a = startOfWeek(cursor)
    const z = addDays(a, 6)
    const same = a.getMonth() === z.getMonth()
    return `${a.getDate()}${same ? '' : ' ' + fmt({ month: 'short' }).format(a)} – ${z.getDate()} ${fmt({ month: 'short' }).format(z)} ${z.getFullYear()}`
  }
  return cap(fmt({ month: 'long', year: 'numeric' }).format(cursor))
}

function step(view, cursor, dir) {
  if (view === 'day') return addDays(cursor, dir)
  if (view === 'week') return addDays(cursor, 7 * dir)
  return new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1)
}

// minutos desde a meia-noite
const minOf = (d) => { const x = new Date(d); return x.getHours() * 60 + x.getMinutes() }

// Faixa de horas a mostrar: horário de trabalho dos dias visíveis + qualquer marcação fora dele
function hourSpan(hours, days, items) {
  const wds = new Set(days.map((d) => d.getDay()))
  let a = Infinity
  let z = -Infinity
  for (const h of hours) if (wds.has(h.weekday)) { a = Math.min(a, toMin(h.start_time)); z = Math.max(z, toMin(h.end_time)) }
  for (const b of items) { a = Math.min(a, minOf(b.starts_at)); z = Math.max(z, sameDay(b.starts_at, b.ends_at) ? minOf(b.ends_at) : 24 * 60) }
  if (!isFinite(a)) { a = 9 * 60; z = 19 * 60 }
  return [Math.floor(a / 60) * 60, Math.min(24 * 60, Math.ceil(z / 60) * 60)]
}

// Marcações sobrepostas ficam lado a lado
function layout(items) {
  const sorted = [...items].sort((x, y) => new Date(x.starts_at) - new Date(y.starts_at))
  const out = []
  let cluster = []
  let clusterEnd = 0
  const flush = () => {
    const lanes = []
    for (const it of cluster) {
      const s = new Date(it.starts_at).getTime()
      let i = lanes.findIndex((end) => end <= s)
      if (i === -1) { i = lanes.length; lanes.push(0) }
      lanes[i] = new Date(it.ends_at).getTime()
      out.push({ b: it, lane: i })
    }
    for (const o of out.slice(out.length - cluster.length)) o.lanes = lanes.length
    cluster = []
  }
  for (const it of sorted) {
    const s = new Date(it.starts_at).getTime()
    if (cluster.length && s >= clusterEnd) flush()
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, new Date(it.ends_at).getTime())
  }
  if (cluster.length) flush()
  return out
}

export function CalendarView({ salon, hours, refreshKey, reload, openClient, openBooking, onNew, listView }) {
  const [view, setView] = useState(readView)
  const [cursor, setCursorState] = useState(() => lastCursor ?? startOfDay(new Date()))
  const setCursor = (d) => { lastCursor = d; setCursorState(d) }
  const [data, setData] = useState({ key: '', bookings: [], blocks: [] })
  const [selected, setSelected] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const [moved, setMoved] = useState(null)
  const [moveErr, setMoveErr] = useState('')

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t) }, [])

  const [from, to] = useMemo(() => rangeFor(view, cursor), [view, cursor])
  const key = `${from.toISOString()}|${to.toISOString()}`

  useEffect(() => {
    if (view === 'list') return
    let alive = true
    Promise.all([
      sb.from('bookings').select('*').eq('salon_id', salon.id).in('status', ['pending', 'confirmed'])
        .lt('starts_at', to.toISOString()).gt('ends_at', from.toISOString()).order('starts_at'),
      sb.from('blocks').select('*').eq('salon_id', salon.id)
        .lt('starts_at', to.toISOString()).gt('ends_at', from.toISOString()).order('starts_at'),
    ]).then(([bk, bl]) => {
      if (alive) setData({ key, bookings: bk.data ?? [], blocks: bl.data ?? [] })
    })
    return () => { alive = false }
  }, [salon.id, view, key, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const loading = data.key !== key
  const bookings = loading ? [] : data.bookings
  const blocks = loading ? [] : data.blocks

  function pick(v) { setView(v); saveView(v); setSelected(null) }

  // arrastar um card para outro horário
  async function onMove(b, start) {
    const end = new Date(start.getTime() + (new Date(b.ends_at) - new Date(b.starts_at)))
    const clash = bookings.find((x) => x.id !== b.id && new Date(x.starts_at) < end && new Date(x.ends_at) > start)
    const msg = `Mudar ${b.client_name} para ${fDay(start)} às ${fTime(start)}?` + (clash ? `\n\nAtenção: fica por cima de ${clash.client_name} (${fTime(clash.starts_at)}).` : '')
    if (!window.confirm(msg)) return
    setMoveErr('')
    const e = await moveBooking(b, start)
    if (e) return setMoveErr(e)
    setData((d) => ({ ...d, bookings: d.bookings.map((x) => (x.id === b.id ? { ...x, starts_at: start.toISOString(), ends_at: end.toISOString() } : x)) }))
    setMoved({ b, start })
    reload()
  }
  function openDay(d) { setCursor(startOfDay(d)); pick('day') }

  const nav = view !== 'list' && (
    <div className="cal-nav">
      <button className="btn small ghost" aria-label="Anterior" onClick={() => { setCursor(step(view, cursor, -1)); setSelected(null) }}>‹</button>
      <button className="btn small ghost" onClick={() => { setCursor(startOfDay(new Date())); setSelected(null) }}>Hoje</button>
      <button className="btn small ghost" aria-label="Seguinte" onClick={() => { setCursor(step(view, cursor, 1)); setSelected(null) }}>›</button>
      <h3 className="cal-title">{title(view, cursor)}</h3>
      {view !== 'month' && !loading && <span className="muted small">{bookings.length} marcaç{bookings.length === 1 ? 'ão' : 'ões'}</span>}
    </div>
  )

  return (
    <div className="stack">
      <div className="cal-switch" role="tablist" aria-label="Vista da agenda">
        {VIEWS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => pick(k)}>{label}</button>
        ))}
      </div>
      {nav}
      {moveErr && <p className="alert">{moveErr}</p>}
      <MovedNotice moved={moved} salon={salon} onClose={() => setMoved(null)} />
      {view === 'list' && listView}
      {view === 'day' && (
        <TimeGrid days={[startOfDay(cursor)]} hours={hours} bookings={bookings} blocks={blocks} now={now} selected={selected}
          onSelect={(id) => id && openBooking(id)} onNew={onNew} onMove={onMove} pxPerHour={72} />
      )}
      {view === 'week' && (
        <TimeGrid days={Array.from({ length: 7 }, (_, i) => addDays(from, i))} hours={hours} bookings={bookings} blocks={blocks} now={now}
          selected={selected} onSelect={(id) => id && openBooking(id)} onNew={onNew} onMove={onMove} onDay={openDay} pxPerHour={52} compact />
      )}
      {view === 'month' && (
        <MonthGrid from={from} to={to} cursor={cursor} hours={hours} bookings={bookings} blocks={blocks} now={now} onDay={openDay} />
      )}
      {view === 'day' && !loading && bookings.length === 0 && <p className="empty">Sem marcações neste dia.</p>}
    </div>
  )
}

function TimeGrid({ days, hours, bookings, blocks, now, selected, onSelect, onNew, onMove, onDay, pxPerHour, compact }) {
  const [a, z] = hourSpan(hours, days, bookings)
  const px = pxPerHour / 60
  const height = (z - a) * px
  const ticks = []
  for (let m = a; m <= z; m += 60) ticks.push(m)

  // ---- arrastar (rato: arrastar logo; toque: carregar ~0,4 s e depois arrastar) ----
  const colRefs = useRef([])
  const dragRef = useRef(null)
  const [drag, setDrag] = useState(null) // { id, dayIdx, min }
  const justDragged = useRef(false)

  function minuteAt(clientY, dayIdx) {
    const r = colRefs.current[dayIdx]?.getBoundingClientRect()
    if (!r) return null
    return a + ((clientY - r.top) / px)
  }
  function dayAt(clientX, fallback) {
    const i = colRefs.current.findIndex((el) => { if (!el) return false; const r = el.getBoundingClientRect(); return clientX >= r.left && clientX <= r.right })
    return i === -1 ? fallback : i
  }

  function startDrag(e, b, dayIdx) {
    if (!onMove || e.button > 0) return
    const startMin = minOf(b.starts_at)
    const st = { b, dayIdx, x: e.clientX, y: e.clientY, grab: minuteAt(e.clientY, dayIdx) - startMin, active: e.pointerType === 'mouse' ? false : null, timer: null }
    if (e.pointerType !== 'mouse') {
      st.timer = setTimeout(() => { st.active = true; navigator.vibrate?.(15); setDrag({ id: b.id, dayIdx, min: startMin }) }, 400)
    }
    dragRef.current = st
    const preventScroll = (ev) => { if (dragRef.current?.active) ev.preventDefault() }
    const move = (ev) => {
      const d = dragRef.current
      if (!d) return
      if (d.active === null) { // toque: mexeu antes do tempo = está a deslocar a página
        if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 8) { clearTimeout(d.timer); end() }
        return
      }
      if (!d.active) { if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 6) return; d.active = true }
      const di = dayAt(ev.clientX, d.dayIdx)
      let m = Math.round((minuteAt(ev.clientY, di) - d.grab) / 15) * 15
      const dur = (new Date(d.b.ends_at) - new Date(d.b.starts_at)) / 6e4
      m = Math.max(a, Math.min(z - Math.min(dur, z - a), m))
      d.target = { dayIdx: di, min: m }
      setDrag({ id: d.b.id, dayIdx: di, min: m })
    }
    const up = () => {
      const d = dragRef.current
      end()
      if (!d?.active || !d.target) return
      justDragged.current = true
      setTimeout(() => { justDragged.current = false }, 50)
      const day = days[d.target.dayIdx]
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(d.target.min / 60), d.target.min % 60)
      if (start.getTime() !== new Date(d.b.starts_at).getTime()) onMove(d.b, start)
    }
    function end() {
      clearTimeout(dragRef.current?.timer)
      dragRef.current = null
      setDrag(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('touchmove', preventScroll)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', end)
    window.addEventListener('touchmove', preventScroll, { passive: false })
  }

  function clickEmpty(e, day) {
    if (!onNew) return
    const r = e.currentTarget.getBoundingClientRect()
    const m = a + Math.round((e.clientY - r.top) / px / 15) * 15
    onNew(new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60))
  }

  return (
    <div className={`tg ${compact ? 'tg-week' : 'tg-day'}`}>
      <div className="tg-inner" style={{ '--cols': days.length }}>
        {days.length > 1 && (
          <div className="tg-head">
            <div />
            {days.map((d) => {
              const n = bookings.filter((b) => sameDay(b.starts_at, d)).length
              return (
                <button key={d.toISOString()} className={`tg-dayhead ${sameDay(d, now) ? 'today' : ''}`} onClick={() => onDay?.(d)} title="Ver o dia">
                  <span>{WD_MON[(d.getDay() + 6) % 7]}</span>
                  <strong>{d.getDate()}</strong>
                  {n > 0 && <span className="tg-n">{n}</span>}
                </button>
              )
            })}
          </div>
        )}
        <div className="tg-body" style={{ height }}>
          <div className="tg-hours">
            {ticks.map((m) => (
              <span key={m} style={{ top: (m - a) * px }}>{pad(m / 60)}:00</span>
            ))}
          </div>
          {days.map((d, di) => {
            const dayStart = startOfDay(d).getTime()
            const dayEnd = addDays(d, 1).getTime()
            const clip = (s, e) => {
              const s1 = Math.max(new Date(s).getTime(), dayStart)
              const e1 = Math.min(new Date(e).getTime(), dayEnd)
              const top = Math.max(0, ((s1 - dayStart) / 6e4 - a) * px)
              const bottom = Math.min(height, ((e1 - dayStart) / 6e4 - a) * px)
              return { top, height: Math.max(0, bottom - top) }
            }
            const wh = hours.filter((h) => h.weekday === d.getDay())
            const items = layout(bookings.filter((b) => new Date(b.starts_at).getTime() < dayEnd && new Date(b.ends_at).getTime() > dayStart))
            const dayBlocks = blocks.filter((b) => new Date(b.starts_at).getTime() < dayEnd && new Date(b.ends_at).getTime() > dayStart)
            const nowTop = sameDay(d, now) ? (minOf(now) - a) * px : null
            return (
              <div key={d.toISOString()} ref={(el) => { colRefs.current[di] = el }} className={`tg-col ${wh.length ? '' : 'closed'} ${drag?.dayIdx === di ? 'drop' : ''}`} onClick={(e) => e.target === e.currentTarget && !justDragged.current && clickEmpty(e, d)}>
                {ticks.slice(0, -1).map((m) => <div key={m} className="tg-line" style={{ top: (m - a) * px }} />)}
                {wh.map((h) => (
                  <div key={h.id ?? h.start_time} className="tg-open" style={{ top: (toMin(h.start_time) - a) * px, height: (toMin(h.end_time) - toMin(h.start_time)) * px }} />
                ))}
                {dayBlocks.map((bl) => (
                  <div key={bl.id} className="tg-block" style={clip(bl.starts_at, bl.ends_at)} title={bl.reason ?? 'Bloqueado'}>
                    {!compact && <span>{bl.reason || 'Bloqueado'}</span>}
                  </div>
                ))}
                {items.map(({ b, lane, lanes }) => {
                  const pos = clip(b.starts_at, b.ends_at)
                  pos.height = Math.max(pos.height, compact ? 18 : 22)
                  const short = pos.height < 40
                  return (
                    <button
                      key={b.id}
                      className={`tg-ev ${b.status} ${selected === b.id ? 'sel' : ''} ${short ? 'short' : ''} ${drag?.id === b.id ? 'dragging' : ''}`}
                      style={{ ...pos, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                      onPointerDown={(e) => startDrag(e, b, di)}
                      onContextMenu={(e) => onMove && e.preventDefault()}
                      onClick={() => { if (!justDragged.current) onSelect(selected === b.id ? null : b.id) }}
                      title={`${fTime(b.starts_at)}–${fTime(b.ends_at)} · ${b.client_name} · ${bookingLabel(b)}${b.status === 'pending' ? ' (pedido por aprovar)' : ''}`}
                    >
                      <span className="tg-ev-time">{fTime(b.starts_at)}{!compact && `–${fTime(b.ends_at)}`}</span>
                      <strong>{b.client_name}</strong>
                      {!short && <span className="tg-ev-svc">{bookingLabel(b)}</span>}
                    </button>
                  )
                })}
                {drag?.dayIdx === di && (() => {
                  const b = bookings.find((x) => x.id === drag.id)
                  if (!b) return null
                  const dur = (new Date(b.ends_at) - new Date(b.starts_at)) / 6e4
                  const hh = `${pad(Math.floor(drag.min / 60))}:${pad(drag.min % 60)}`
                  return (
                    <div className="tg-ghost" style={{ top: (drag.min - a) * px, height: Math.max(dur * px, 22) }}>
                      <b>{hh}</b> {b.client_name.split(' ')[0]}
                    </div>
                  )
                })()}
                {nowTop !== null && nowTop >= 0 && nowTop <= height && <div className="tg-now" style={{ top: nowTop }} />}
              </div>
            )
          })}
        </div>
      </div>
      {onNew && <p className="muted small tg-hint">Toque num espaço livre para marcar nesse horário. Para mudar uma marcação de horário, arraste o cartão (no telemóvel: carregue nele um instante e arraste).</p>}
    </div>
  )
}

function MonthGrid({ from, to, cursor, hours, bookings, blocks, now, onDay }) {
  const days = []
  for (let d = from; d < to; d = addDays(d, 1)) days.push(d)
  const open = new Set(hours.map((h) => h.weekday))
  return (
    <div className="mg">
      {WD_MON.map((w) => <div key={w} className="mg-wd">{w}</div>)}
      {days.map((d) => {
        const list = bookings.filter((b) => sameDay(b.starts_at, d))
        const blocked = blocks.some((bl) => new Date(bl.starts_at) < addDays(d, 1) && new Date(bl.ends_at) > d)
        const out = d.getMonth() !== cursor.getMonth()
        const pending = list.filter((b) => b.status === 'pending').length
        return (
          <button key={d.toISOString()} className={`mg-cell ${out ? 'out' : ''} ${sameDay(d, now) ? 'today' : ''} ${open.has(d.getDay()) ? '' : 'closed'}`} onClick={() => onDay(d)}>
            <span className="mg-num">{d.getDate()}</span>
            {list.slice(0, 3).map((b) => (
              <span key={b.id} className={`mg-ev ${b.status}`}><b>{fTime(b.starts_at)}</b> {b.client_name.split(' ')[0]}</span>
            ))}
            {list.length > 3 && <span className="mg-more">+{list.length - 3}</span>}
            <span className="mg-dots">
              {list.length > 0 && <span className="mg-count">{list.length}</span>}
              {pending > 0 && <span className="mg-pend" title="Pedidos por aprovar">{pending}</span>}
              {blocked && <span className="mg-blk" title="Tem bloqueio">⦸</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
