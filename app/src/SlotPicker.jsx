import { useEffect, useMemo, useState } from 'react'
import { sb, openDays, freeSlots, startOfDay, addDays, sameDay, fDay, fTime, WD_SHORT } from './lib.js'

export default function SlotPicker({ salon, durationMin, ignore, selected, onSelect, refreshKey }) {
  const days = useMemo(() => openDays(salon.hours, salon.max_days_ahead), [salon])
  const [busy, setBusy] = useState(null)
  const [day, setDay] = useState(null)

  useEffect(() => {
    const from = startOfDay(new Date())
    const to = addDays(from, salon.max_days_ahead + 1)
    sb.rpc('get_busy', { p_slug: salon.slug, p_from: from.toISOString(), p_to: to.toISOString() }).then(({ data }) => {
      const all = data ?? []
      setBusy(
        ignore
          ? all.filter((b) => new Date(b.starts_at).getTime() !== new Date(ignore.starts_at).getTime() || new Date(b.ends_at).getTime() !== new Date(ignore.ends_at).getTime())
          : all,
      )
    })
  }, [salon, ignore, refreshKey])

  const byDay = useMemo(
    () =>
      busy
        ? new Map(days.map((d) => [d.getTime(), freeSlots({ day: d, hours: salon.hours, durationMin, stepMin: salon.slot_step_min, busy, minNoticeHours: salon.min_notice_hours })]))
        : new Map(),
    [busy, days, salon, durationMin],
  )

  useEffect(() => {
    if (!busy || day) return
    const first = days.find((d) => (byDay.get(d.getTime()) ?? []).length > 0)
    if (first) setDay(first)
  }, [busy, days, byDay, day])

  if (!busy) return <p className="muted">A carregar horários…</p>
  if (days.length === 0) return <p className="muted">Ainda não há horários de funcionamento definidos.</p>
  const slots = day ? byDay.get(day.getTime()) ?? [] : []

  return (
    <div className="slot-picker">
      <div className="day-strip" role="listbox" aria-label="Escolher dia">
        {days.map((d) => {
          const n = (byDay.get(d.getTime()) ?? []).length
          const on = day && sameDay(d, day)
          return (
            <button key={d.getTime()} type="button" role="option" aria-selected={!!on} className={`day ${on ? 'active' : ''} ${n ? '' : 'full'}`} disabled={!n} onClick={() => setDay(d)}>
              <span className="dow">{WD_SHORT[d.getDay()]}</span>
              <span className="dnum">{d.getDate()}</span>
              <span className="dmon">{new Intl.DateTimeFormat('pt-PT', { month: 'short' }).format(d)}</span>
            </button>
          )
        })}
      </div>
      {day && (
        <>
          <p className="day-title">{fDay(day)}</p>
          {slots.length === 0 ? (
            <p className="muted">Sem vagas neste dia.</p>
          ) : (
            <div className="slots">
              {slots.map((s) => (
                <button key={s.getTime()} type="button" className={`slot ${selected?.getTime() === s.getTime() ? 'active' : ''}`} onClick={() => onSelect(s)}>
                  {fTime(s)}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
