import { useState } from 'react'
import { sb, errMsg, fDur, fMoney, WEEKDAYS, isoDate, addDays, fDay, fTime, SUPABASE_URL } from './lib.js'

const EMPTY = { name: '', description: '', duration: '30', price: '' }

export function Services({ salon, services, reload }) {
  const [f, setF] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')

  function edit(s) {
    setEditId(s.id); setOpen(true)
    setF({ name: s.name, description: s.description ?? '', duration: String(s.duration_min), price: s.price_cents == null ? '' : String(s.price_cents / 100) })
  }
  async function save(e) {
    e.preventDefault(); setError('')
    const row = {
      salon_id: salon.id,
      name: f.name.trim(),
      description: f.description.trim() || null,
      duration_min: Number(f.duration),
      price_cents: f.price === '' ? null : Math.round(Number(f.price.replace(',', '.')) * 100),
    }
    const { error } = editId ? await sb.from('services').update(row).eq('id', editId) : await sb.from('services').insert({ ...row, sort: services.length })
    if (error) return setError(errMsg(error))
    setF(EMPTY); setEditId(null); setOpen(false); reload()
  }
  async function toggle(s) { await sb.from('services').update({ active: !s.active }).eq('id', s.id); reload() }
  async function move(s, dir) {
    const list = [...services]
    const i = list.findIndex((x) => x.id === s.id)
    const j = i + dir
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    await Promise.all(list.map((x, k) => (x.sort !== k ? sb.from('services').update({ sort: k }).eq('id', x.id) : null)))
    reload()
  }
  async function del(s) {
    if (!confirm(`Apagar "${s.name}"? As marcações antigas mantêm-se.`)) return
    const { error } = await sb.from('services').delete().eq('id', s.id)
    if (error) { await sb.from('services').update({ active: false }).eq('id', s.id); alert('Este serviço tem marcações ligadas, por isso foi apenas ocultado.') }
    reload()
  }

  return (
    <div className="stack">
      {services.length === 0 && <p className="empty">Adicione o primeiro serviço para as clientes poderem marcar.</p>}
      {services.map((s, i) => (
        <div key={s.id} className={`card service-admin ${s.active ? '' : 'inactive'}`}>
          <div>
            <strong>{s.name}</strong>
            <span className="muted small block">{fDur(s.duration_min)} · {fMoney(s.price_cents) || 'sem preço'}{!s.active && ' · oculto'}</span>
          </div>
          <div className="row-actions">
            <button className="btn small ghost" aria-label="Subir" disabled={i === 0} onClick={() => move(s, -1)}>↑</button>
            <button className="btn small ghost" aria-label="Descer" disabled={i === services.length - 1} onClick={() => move(s, 1)}>↓</button>
            <button className="btn small ghost" onClick={() => edit(s)}>Editar</button>
            <button className="btn small ghost" onClick={() => toggle(s)}>{s.active ? 'Ocultar' : 'Mostrar'}</button>
            <button className="btn small ghost danger" onClick={() => del(s)}>Apagar</button>
          </div>
        </div>
      ))}
      {open ? (
        <form className="card stack" onSubmit={save}>
          <h3>{editId ? 'Editar serviço' : 'Novo serviço'}</h3>
          {error && <p className="alert">{error}</p>}
          <label>Nome<input required maxLength={80} placeholder="Laser — axilas" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Descrição <span className="muted">(opcional)</span><input maxLength={160} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          <div className="two">
            <label>Duração (min)<input required type="number" min={5} max={600} step={5} value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} /></label>
            <label>Preço (€)<input inputMode="decimal" placeholder="25" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
          </div>
          <div className="row-actions">
            <button className="btn primary">Guardar</button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button>
          </div>
        </form>
      ) : (
        <button className="btn primary" onClick={() => { setOpen(true); setEditId(null); setF(EMPTY) }}>+ Novo serviço</button>
      )}
    </div>
  )
}

const ORDER = [1, 2, 3, 4, 5, 6, 0]

export function Hours({ salon, hours, reload }) {
  const [adding, setAdding] = useState(null)
  const [a, setA] = useState('09:00')
  const [z, setZ] = useState('13:00')
  const [error, setError] = useState('')

  async function add(day) {
    setError('')
    if (z <= a) return setError('A hora de fim tem de ser depois do início.')
    const { error } = await sb.from('working_hours').insert({ salon_id: salon.id, weekday: day, start_time: a, end_time: z })
    if (error) return setError(errMsg(error))
    setAdding(null); reload()
  }
  async function remove(id) { await sb.from('working_hours').delete().eq('id', id); reload() }
  async function copyWeek(day) {
    const src = hours.filter((h) => h.weekday === day)
    if (!confirm('Copiar este horário para segunda a sábado (substitui os outros dias)?')) return
    const others = [1, 2, 3, 4, 5, 6].filter((d) => d !== day)
    await sb.from('working_hours').delete().eq('salon_id', salon.id).in('weekday', others)
    await sb.from('working_hours').insert(others.flatMap((d) => src.map((h) => ({ salon_id: salon.id, weekday: d, start_time: h.start_time, end_time: h.end_time }))))
    reload()
  }

  return (
    <div className="stack">
      <p className="muted small">Pode ter mais de um intervalo por dia (ex.: 9h–13h e 14h–19h para a pausa de almoço).</p>
      {error && <p className="alert">{error}</p>}
      {ORDER.map((d) => {
        const list = hours.filter((h) => h.weekday === d)
        return (
          <div key={d} className="card hours-day">
            <div className="hours-head">
              <strong>{WEEKDAYS[d]}</strong>
              {list.length === 0 && <span className="muted small">Fechado</span>}
            </div>
            <div className="chips">
              {list.map((h) => (
                <span key={h.id} className="chip">
                  {h.start_time.slice(0, 5)}–{h.end_time.slice(0, 5)}
                  <button aria-label="Remover intervalo" onClick={() => remove(h.id)}>×</button>
                </span>
              ))}
            </div>
            {adding === d ? (
              <div className="inline-form">
                <input type="time" value={a} onChange={(e) => setA(e.target.value)} aria-label="Início" />
                <span>–</span>
                <input type="time" value={z} onChange={(e) => setZ(e.target.value)} aria-label="Fim" />
                <button className="btn small primary" onClick={() => add(d)}>OK</button>
                <button className="btn small ghost" onClick={() => setAdding(null)}>×</button>
              </div>
            ) : (
              <div className="row-actions">
                <button className="link" onClick={() => setAdding(d)}>+ intervalo</button>
                {list.length > 0 && <button className="link" onClick={() => copyWeek(d)}>copiar para a semana</button>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function Blocks({ salon, blocks, reload }) {
  const today = isoDate(new Date())
  const [f, setF] = useState({ from: today, to: today, allDay: true, start: '13:00', end: '14:00', reason: '' })
  const [error, setError] = useState('')

  async function save(e) {
    e.preventDefault(); setError('')
    const [y, m, d] = f.from.split('-').map(Number)
    const [y2, m2, d2] = (f.allDay ? f.to : f.from).split('-').map(Number)
    let s, t
    if (f.allDay) { s = new Date(y, m - 1, d); t = addDays(new Date(y2, m2 - 1, d2), 1) } else {
      const [h1, n1] = f.start.split(':').map(Number)
      const [h2, n2] = f.end.split(':').map(Number)
      s = new Date(y, m - 1, d, h1, n1); t = new Date(y, m - 1, d, h2, n2)
    }
    if (t <= s) return setError('O fim tem de ser depois do início.')
    const { error } = await sb.from('blocks').insert({ salon_id: salon.id, starts_at: s.toISOString(), ends_at: t.toISOString(), reason: f.reason || null })
    if (error) return setError(errMsg(error))
    setF({ ...f, reason: '' }); reload()
  }
  async function remove(id) { await sb.from('blocks').delete().eq('id', id); reload() }
  const future = blocks.filter((b) => new Date(b.ends_at) > new Date())

  return (
    <div className="stack">
      <form className="card stack" onSubmit={save}>
        <h3>Bloquear horário</h3>
        <p className="muted small">Folgas, férias, dias no outro salão… As clientes deixam de ver estes horários.</p>
        {error && <p className="alert">{error}</p>}
        <label className="check"><input type="checkbox" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.target.checked })} /> Dia(s) inteiro(s)</label>
        {f.allDay ? (
          <div className="two">
            <label>De<input type="date" required min={today} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: e.target.value > f.to ? e.target.value : f.to })} /></label>
            <label>Até<input type="date" required min={f.from} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
          </div>
        ) : (
          <>
            <label>Dia<input type="date" required min={today} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
            <div className="two">
              <label>Das<input type="time" required value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
              <label>Às<input type="time" required value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
            </div>
          </>
        )}
        <label>Motivo <span className="muted">(só você vê)</span><input maxLength={80} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Ex.: SGART" /></label>
        <button className="btn primary">Bloquear</button>
      </form>
      {future.length === 0 ? (
        <p className="empty">Nenhum bloqueio futuro.</p>
      ) : (
        future.map((b) => {
          const s = new Date(b.starts_at)
          const t = new Date(b.ends_at)
          const whole = s.getHours() === 0 && s.getMinutes() === 0 && t.getHours() === 0 && t.getMinutes() === 0
          const label = whole ? (t - s <= 864e5 ? fDay(s) : `${fDay(s)} → ${fDay(addDays(t, -1))}`) : `${fDay(s)}, ${fTime(s)}–${fTime(t)}`
          return (
            <div key={b.id} className="card service-admin">
              <div><strong>{label}</strong>{b.reason && <span className="muted small block">{b.reason}</span>}</div>
              <button className="btn small ghost danger" onClick={() => remove(b.id)}>Remover</button>
            </div>
          )
        })
      )}
    </div>
  )
}

function CopyField({ label, value }) {
  const [ok, setOk] = useState(false)
  return (
    <div className="copy-field">
      <span className="small muted">{label}</span>
      <div>
        <input readOnly value={value} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn small" onClick={async () => { try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1500) } catch {} }}>
          {ok ? 'Copiado!' : 'Copiar'}
        </button>
      </div>
    </div>
  )
}

export function Settings({ salon, reload }) {
  const [f, setF] = useState({
    name: salon.name, phone: salon.phone ?? '', address: salon.address ?? '', notify_email: salon.notify_email ?? '',
    min_notice_hours: salon.min_notice_hours, max_days_ahead: salon.max_days_ahead, cancel_limit_hours: salon.cancel_limit_hours, slot_step_min: salon.slot_step_min,
  })
  const [ok, setOk] = useState('')
  const [error, setError] = useState('')
  const link = `${location.href.split('#')[0]}#/s/${salon.slug}`
  const feed = `${SUPABASE_URL}/functions/v1/calendar-feed?token=${salon.calendar_token}`
  const webcal = feed.replace(/^https?:/, 'webcal:')

  async function save(e) {
    e.preventDefault(); setOk(''); setError('')
    const { error } = await sb.from('salons').update({ ...f, phone: f.phone || null, address: f.address || null, notify_email: f.notify_email || null }).eq('id', salon.id)
    if (error) return setError(errMsg(error))
    setOk('Guardado ✓'); reload()
  }
  async function newToken() {
    if (!confirm('Gerar um novo link? O antigo deixa de funcionar e terá de voltar a assinar no calendário.')) return
    await sb.from('salons').update({ calendar_token: crypto.randomUUID() }).eq('id', salon.id); reload()
  }
  const num = (k) => (e) => setF({ ...f, [k]: Number(e.target.value) })

  return (
    <div className="stack">
      <section className="card stack">
        <h3>Link para as clientes</h3>
        <p className="muted small">Ponha na bio do Instagram, no WhatsApp Business e no Google.</p>
        <CopyField label="Link de marcação" value={link} />
        <div className="row-actions">
          <a className="btn small" href={`#/s/${salon.slug}`}>Ver como cliente</a>
          {'share' in navigator && <button className="btn small ghost" onClick={() => navigator.share({ title: `Marcar — ${salon.name}`, url: link }).catch(() => {})}>Partilhar</button>}
        </div>
      </section>
      <section className="card stack">
        <h3>Receber as marcações no seu calendário</h3>
        <p className="muted small">Assine este link uma vez e cada marcação aparece no telemóvel. Pedidos pendentes aparecem com ⏳.</p>
        <CopyField label="Link do calendário (privado — não partilhe)" value={feed} />
        <a className="btn small" href={webcal}>Abrir no iPhone / Mac</a>
        <details>
          <summary>Como assinar no Google Calendar</summary>
          <ol className="small">
            <li>No computador, abra <b>calendar.google.com</b>.</li>
            <li>Ao lado de “Outros calendários”, toque em <b>+</b> → <b>A partir do URL</b>.</li>
            <li>Cole o link acima e confirme.</li>
            <li>Nas definições desse calendário, ative as <b>notificações</b>.</li>
          </ol>
          <p className="muted small">O Google atualiza calendários assinados de poucas em poucas horas; no iPhone a atualização é mais rápida.</p>
        </details>
        <button className="link small" onClick={newToken}>Gerar novo link</button>
      </section>
      <form className="card stack" onSubmit={save}>
        <h3>Dados e regras</h3>
        {ok && <p className="notice">{ok}</p>}
        {error && <p className="alert">{error}</p>}
        <label>Nome<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Telefone<input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label>Morada<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
        <label>E-mail para avisos de pedidos<input type="email" value={f.notify_email} onChange={(e) => setF({ ...f, notify_email: e.target.value })} /></label>
        <div className="two">
          <label>Antecedência mínima (h)<input type="number" min={0} max={168} value={f.min_notice_hours} onChange={num('min_notice_hours')} /></label>
          <label>Marcar até (dias)<input type="number" min={1} max={365} value={f.max_days_ahead} onChange={num('max_days_ahead')} /></label>
          <label>Cancelar online até (h antes)<input type="number" min={0} max={168} value={f.cancel_limit_hours} onChange={num('cancel_limit_hours')} /></label>
          <label>
            Intervalo dos horários
            <select value={f.slot_step_min} onChange={num('slot_step_min')}>
              {[10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
          </label>
        </div>
        <button className="btn primary">Guardar</button>
      </form>
    </div>
  )
}
