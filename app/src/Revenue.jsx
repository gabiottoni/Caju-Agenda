import { useEffect, useMemo, useState } from 'react'
import { sb, addDays, startOfDay, fDay, fTime, fMoney, bookingServices, bookingLabel } from './lib.js'

const PERIODS = [
  ['day', 'Dia'],
  ['week', 'Semana'],
  ['month', 'Mês'],
]
const fmt = (o) => new Intl.DateTimeFormat('pt-PT', o)
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const startOfWeek = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7))

function range(period, cursor) {
  if (period === 'day') { const a = startOfDay(cursor); return [a, addDays(a, 1)] }
  if (period === 'week') { const a = startOfWeek(cursor); return [a, addDays(a, 7)] }
  const a = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  return [a, new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)]
}
function shift(period, cursor, dir) {
  if (period === 'day') return addDays(cursor, dir)
  if (period === 'week') return addDays(cursor, 7 * dir)
  return new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1)
}
function title(period, cursor) {
  if (period === 'day') return cap(fDay(cursor))
  if (period === 'week') {
    const a = startOfWeek(cursor)
    const z = addDays(a, 6)
    return `${a.getDate()} ${fmt({ month: 'short' }).format(a)} – ${z.getDate()} ${fmt({ month: 'short' }).format(z)}`
  }
  return cap(fmt({ month: 'long', year: 'numeric' }).format(cursor))
}
const prevLabel = { day: 'dia anterior', week: 'semana anterior', month: 'mês anterior' }

export function RevenueTab({ salon, services }) {
  const [period, setPeriod] = useState(() => { try { return localStorage.getItem('caju.revPeriod') || 'month' } catch { return 'month' } })
  const [cursor, setCursor] = useState(() => startOfDay(new Date()))
  const [rows, setRows] = useState(null)
  const [cur0, cur1] = useMemo(() => range(period, cursor), [period, cursor])
  const [prev0] = useMemo(() => range(period, shift(period, cursor, -1)), [period, cursor])

  useEffect(() => {
    let alive = true
    setRows(null)
    ;(async () => {
      const out = []
      for (let from = 0; ; from += 1000) {
        const { data } = await sb.from('bookings').select('id, starts_at, ends_at, status, client_name, client_id, service_id, service_name, services')
          .eq('salon_id', salon.id).in('status', ['confirmed', 'pending'])
          .gte('starts_at', prev0.toISOString()).lt('starts_at', cur1.toISOString())
          .order('starts_at').range(from, from + 999)
        out.push(...(data ?? []))
        if (!data || data.length < 1000) break
      }
      if (alive) setRows(out)
    })()
    return () => { alive = false }
  }, [salon.id, prev0, cur1])

  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])
  // valor de uma marcação: preço guardado em cada serviço, ou o preço atual do serviço
  const value = (b) => {
    let total = 0
    let missing = false
    for (const s of bookingServices(b)) {
      const p = s.price_cents ?? (s.id ? byId.get(s.id)?.price_cents : null)
      if (p == null) missing = true
      else total += p
    }
    return { total, missing }
  }

  if (rows === null) return <div className="stack"><Header /><p className="muted">A calcular…</p></div>

  const now = Date.now()
  const inCur = rows.filter((b) => new Date(b.starts_at) >= cur0)
  const inPrev = rows.filter((b) => new Date(b.starts_at) < cur0)
  const done = inCur.filter((b) => b.status === 'confirmed' && new Date(b.starts_at).getTime() <= now)
  const future = inCur.filter((b) => b.status === 'confirmed' && new Date(b.starts_at).getTime() > now)
  const pending = inCur.filter((b) => b.status === 'pending' && new Date(b.starts_at).getTime() > now)
  const prevDone = inPrev.filter((b) => b.status === 'confirmed' && new Date(b.starts_at).getTime() <= now)
  const sum = (list) => list.reduce((a, b) => a + value(b).total, 0)
  const realizado = sum(done)
  const previsto = sum(future)
  const porAprovar = sum(pending)
  const anterior = sum(prevDone)
  const semPreco = [...done, ...future].filter((b) => value(b).missing).length
  const ticket = done.length ? realizado / done.length : 0
  const diff = anterior ? Math.round(((realizado - anterior) / anterior) * 100) : null

  // barras por dia (semana / mês)
  const bars = []
  if (period !== 'day') {
    for (let d = cur0; d < cur1; d = addDays(d, 1)) {
      const list = [...done, ...future].filter((b) => startOfDay(new Date(b.starts_at)).getTime() === d.getTime())
      bars.push({ d, done: sum(list.filter((b) => new Date(b.starts_at).getTime() <= now)), future: sum(list.filter((b) => new Date(b.starts_at).getTime() > now)), n: list.length })
    }
  }
  const maxBar = Math.max(1, ...bars.map((x) => x.done + x.future))

  // serviços que mais faturaram no período
  const svc = new Map()
  for (const b of [...done, ...future]) {
    for (const s of bookingServices(b)) {
      const p = s.price_cents ?? (s.id ? byId.get(s.id)?.price_cents : null) ?? 0
      const k = s.name ?? '—'
      const v = svc.get(k) ?? { n: 0, total: 0 }
      v.n += 1; v.total += p
      svc.set(k, v)
    }
  }
  const topSvc = [...svc.entries()].sort((x, y) => y[1].total - x[1].total).slice(0, 6)

  function Header() {
    return (
      <>
        <div className="cal-switch" role="tablist" aria-label="Período">
          {PERIODS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={period === k} className={period === k ? 'on' : ''} onClick={() => { setPeriod(k); try { localStorage.setItem('caju.revPeriod', k) } catch { /* */ } }}>{label}</button>
          ))}
        </div>
        <div className="cal-nav">
          <button className="btn small ghost" aria-label="Anterior" onClick={() => setCursor(shift(period, cursor, -1))}>‹</button>
          <button className="btn small ghost" onClick={() => setCursor(startOfDay(new Date()))}>{period === 'day' ? 'Hoje' : period === 'week' ? 'Esta semana' : 'Este mês'}</button>
          <button className="btn small ghost" aria-label="Seguinte" onClick={() => setCursor(shift(period, cursor, 1))}>›</button>
          <h3 className="cal-title">{title(period, cursor)}</h3>
        </div>
      </>
    )
  }

  return (
    <div className="stack">
      <Header />
      <div className="rev-cards">
        <div className="card rev-main">
          <span className="muted small">Faturado</span>
          <strong>{fMoney(realizado)}</strong>
          <span className="small">
            {done.length} atendimento{done.length === 1 ? '' : 's'}
            {diff !== null && <span className={diff >= 0 ? 'up' : 'down'}> · {diff >= 0 ? '▲' : '▼'} {Math.abs(diff)}% vs {prevLabel[period]}</span>}
          </span>
        </div>
        <div className="card">
          <span className="muted small">Ainda por fazer</span>
          <strong>{fMoney(previsto)}</strong>
          <span className="small muted">{future.length} confirmada{future.length === 1 ? '' : 's'}</span>
        </div>
        <div className="card">
          <span className="muted small">Total previsto</span>
          <strong>{fMoney(realizado + previsto)}</strong>
          {porAprovar > 0 && <span className="small muted">+ {fMoney(porAprovar)} em pedidos</span>}
        </div>
        <div className="card">
          <span className="muted small">Ticket médio</span>
          <strong>{fMoney(Math.round(ticket))}</strong>
          <span className="small muted">{prevLabel[period]}: {fMoney(anterior)}</span>
        </div>
      </div>

      {period !== 'day' && (
        <section className="card stack">
          <h3>Por dia</h3>
          <div className={`rev-bars ${period}`}>
            {bars.map((x) => (
              <div key={x.d.toISOString()} className="rev-bar" title={`${fDay(x.d)}: ${fMoney(x.done + x.future)} (${x.n})`}>
                <div className="rev-col">
                  {x.future > 0 && <span className="fut" style={{ height: `${(x.future / maxBar) * 100}%` }} />}
                  {x.done > 0 && <span className="done" style={{ height: `${(x.done / maxBar) * 100}%` }} />}
                </div>
                <span className="rev-lbl">{period === 'week' ? fmt({ weekday: 'short' }).format(x.d).replace('.', '') : x.d.getDate()}</span>
              </div>
            ))}
          </div>
          <span className="small muted"><span className="dot done" /> faturado · <span className="dot fut" /> por fazer</span>
        </section>
      )}

      {period === 'day' && (
        <section className="card stack">
          <h3>Atendimentos do dia</h3>
          {done.length + future.length === 0 && <p className="muted small">Sem marcações confirmadas.</p>}
          {[...done, ...future].map((b) => {
            const v = value(b)
            return (
              <div key={b.id} className="rev-row">
                <span className="hist-date">{fTime(b.starts_at)}</span>
                <span className="grow">{b.client_name} <span className="muted small">· {bookingLabel(b)}</span></span>
                <strong>{v.missing && !v.total ? '—' : fMoney(v.total)}</strong>
              </div>
            )
          })}
        </section>
      )}

      {topSvc.length > 0 && (
        <section className="card stack">
          <h3>Serviços</h3>
          {topSvc.map(([name, v]) => (
            <div key={name} className="rev-row">
              <span className="grow">{name} <span className="muted small">× {v.n}</span></span>
              <strong>{v.total ? fMoney(v.total) : '—'}</strong>
            </div>
          ))}
        </section>
      )}
      {semPreco > 0 && <p className="muted small">{semPreco} marcaç{semPreco === 1 ? 'ão' : 'ões'} deste período têm serviços sem preço (ex.: serviços antigos importados da Noona) e contam como 0 €.</p>}
      <p className="muted small">Valores pelos preços dos serviços; não inclui descontos nem gorjetas.</p>
    </div>
  )
}
