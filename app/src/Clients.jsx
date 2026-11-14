import { useEffect, useMemo, useState } from 'react'
import { sb, errMsg, fDate, fTime, waLink, bookingLabel, phoneDigits, validEmail } from './lib.js'

const STATUS_PT = { pending: 'pendente', confirmed: '', declined: 'recusada', cancelled: 'cancelada' }

export function allTags(clients) {
  return [...new Set(clients.flatMap((c) => c.tags ?? []))].sort((a, b) => a.localeCompare(b, 'pt'))
}

function csvCell(v) {
  const s = String(v ?? '')
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Exporta no formato que o Meta (Pixel / públicos personalizados) e o Google aceitam
function exportCsv(list, salonName) {
  const head = ['phone', 'email', 'fn', 'ln', 'country', 'grupos', 'visitas', 'ultima_visita', 'cliente_desde']
  const rows = list.map((c) => {
    let p = phoneDigits(c.phone)
    if (p.length === 9) p = '351' + p
    const [fn, ...ln] = c.name.trim().split(/\s+/)
    return [p ? '+' + p : '', c.email ?? '', fn ?? '', ln.join(' '), p.startsWith('55') ? 'BR' : p.startsWith('44') ? 'GB' : 'PT', (c.tags ?? []).join(' | '), c.visits, c.last_visit ? c.last_visit.slice(0, 10) : '', c.client_since ?? '']
  })
  const csv = '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `clientes-${salonName.toLowerCase().replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
}

export function ClientsTab({ salon, clients, reload, openClient, onNewBooking }) {
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState('recent')
  const [adding, setAdding] = useState(false)
  const tags = useMemo(() => allTags(clients), [clients])

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const digits = t.replace(/\D/g, '')
    let l = clients.filter((c) => {
      if (tag === '__none' && (c.tags ?? []).length) return false
      if (tag && tag !== '__none' && !(c.tags ?? []).includes(tag)) return false
      if (!t) return true
      return c.name.toLowerCase().includes(t) || (c.email ?? '').toLowerCase().includes(t) || (digits.length >= 3 && phoneDigits(c.phone).includes(digits))
    })
    const by = {
      recent: (a, b) => (b.last_visit ?? '').localeCompare(a.last_visit ?? ''),
      visits: (a, b) => b.visits - a.visits,
      name: (a, b) => a.name.localeCompare(b.name, 'pt'),
      new: (a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''),
    }[sort]
    return [...l].sort(by)
  }, [clients, q, tag, sort])

  return (
    <div className="stack">
      <div className="row-actions">
        <button className="btn primary small" onClick={() => setAdding(true)}>+ Nova cliente</button>
        <button className="btn small ghost" onClick={() => exportCsv(list, salon.name)}>Exportar {list.length} (CSV)</button>
      </div>
      {adding && <ClientForm salon={salon} tags={tags} onCancel={() => setAdding(false)} onSaved={(c) => { setAdding(false); reload(); openClient(c.id) }} />}
      <input type="search" placeholder="Procurar por nome, telemóvel ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        <button className={`chip pick ${tag === '' ? 'on' : ''}`} onClick={() => setTag('')}>Todas · {clients.length}</button>
        {tags.map((t) => (
          <button key={t} className={`chip pick ${tag === t ? 'on' : ''}`} onClick={() => setTag(tag === t ? '' : t)}>
            {t} · {clients.filter((c) => (c.tags ?? []).includes(t)).length}
          </button>
        ))}
        <button className={`chip pick ${tag === '__none' ? 'on' : ''}`} onClick={() => setTag(tag === '__none' ? '' : '__none')}>Sem grupo</button>
      </div>
      <label className="inline-label small muted">
        Ordenar por{' '}
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recent">Última visita</option>
          <option value="visits">Mais visitas</option>
          <option value="name">Nome</option>
          <option value="new">Mais recentes</option>
        </select>
      </label>
      {list.length === 0 && <p className="empty">Nenhuma cliente encontrada.</p>}
      <div className="stack tight">
        {list.map((c) => (
          <button key={c.id} className="card client-row" onClick={() => openClient(c.id)}>
            <span className="grow">
              <strong>{c.name}</strong>
              <span className="muted small block">{[c.phone, c.email].filter(Boolean).join(' · ') || 'sem contacto'}</span>
              {(c.tags ?? []).length > 0 && <span className="tag-line">{c.tags.map((t) => <span key={t} className="tag">{t}</span>)}</span>}
            </span>
            <span className="client-meta">
              <strong>{c.visits}</strong>
              <span className="muted small">{c.visits === 1 ? 'visita' : 'visitas'}</span>
              {c.next_visit ? <span className="small next">próx. {fDate(c.next_visit).slice(0, 5)}</span> : c.last_visit && <span className="muted small">últ. {fDate(c.last_visit)}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function TagEditor({ value, onChange, suggestions }) {
  const [t, setT] = useState('')
  const add = (v) => {
    const x = v.trim()
    if (x && !value.includes(x)) onChange([...value, x])
    setT('')
  }
  return (
    <div className="stack tight">
      <div className="chips">
        {value.map((x) => (
          <span key={x} className="chip">
            {x}
            <button type="button" aria-label={`Tirar do grupo ${x}`} onClick={() => onChange(value.filter((y) => y !== x))}>×</button>
          </span>
        ))}
        {suggestions.filter((s) => !value.includes(s)).map((s) => (
          <button type="button" key={s} className="chip pick" onClick={() => add(s)}>+ {s}</button>
        ))}
      </div>
      <div className="inline-form">
        <input placeholder="Novo grupo (ex.: Laser, VIP)" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(t) } }} />
        <button type="button" className="btn small" onClick={() => add(t)}>Adicionar</button>
      </div>
    </div>
  )
}

function ClientForm({ salon, client, tags, onSaved, onCancel }) {
  const [f, setF] = useState({ name: client?.name ?? '', phone: client?.phone ?? '', email: client?.email ?? '', notes: client?.notes ?? '', tags: client?.tags ?? [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  async function save(e) {
    e.preventDefault()
    setError('')
    if (f.email.trim() && !validEmail(f.email.trim())) return setError('E-mail inválido.')
    setBusy(true)
    const row = { name: f.name.trim(), phone: f.phone.trim() || null, email: f.email.trim().toLowerCase() || null, notes: f.notes.trim() || null, tags: f.tags }
    const res = client
      ? await sb.from('clients').update(row).eq('id', client.id).select('*').single()
      : await sb.from('clients').insert({ ...row, salon_id: salon.id, source: 'salon' }).select('*').single()
    setBusy(false)
    if (res.error) return setError(errMsg(res.error))
    onSaved(res.data)
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h3>{client ? 'Editar cliente' : 'Nova cliente'}</h3>
      {error && <p className="alert">{error}</p>}
      <label>Nome<input required maxLength={80} value={f.name} onChange={set('name')} /></label>
      <div className="two">
        <label>Telemóvel<input type="tel" value={f.phone} onChange={set('phone')} /></label>
        <label>E-mail<input type="email" value={f.email} onChange={set('email')} /></label>
      </div>
      <label>Notas<textarea rows={3} maxLength={2000} value={f.notes} onChange={set('notes')} placeholder="Preferências, cuidados, fototipo…" /></label>
      <div className="stack tight">
        <span className="small muted">Grupos</span>
        <TagEditor value={f.tags} onChange={(tags) => setF({ ...f, tags })} suggestions={tags} />
      </div>
      <div className="row-actions">
        <button className="btn primary" disabled={busy}>{busy ? 'A guardar…' : 'Guardar'}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  )
}

export function ClientSheet({ salon, clientId, clients, reload, onClose, onNewBooking }) {
  const client = clients.find((c) => c.id === clientId)
  const [history, setHistory] = useState(null)
  const [editing, setEditing] = useState(false)
  const [merging, setMerging] = useState(false)
  const [mq, setMq] = useState('')
  const [error, setError] = useState('')
  const tags = useMemo(() => allTags(clients), [clients])

  useEffect(() => {
    setHistory(null)
    sb.from('bookings').select('id, starts_at, ends_at, status, service_name, services, client_name, notes, source').eq('client_id', clientId).order('starts_at', { ascending: false }).then(({ data }) => setHistory(data ?? []))
  }, [clientId, clients])

  if (!client) return <div className="stack"><button className="link back" onClick={onClose}>← Clientes</button><p className="muted">A carregar…</p></div>

  const done = (history ?? []).filter((b) => b.status === 'confirmed' && new Date(b.starts_at) <= new Date())
  const counts = {}
  for (const b of done) for (const s of Array.isArray(b.services) && b.services.length ? b.services : [{ name: b.service_name }]) counts[s.name] = (counts[s.name] ?? 0) + 1
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4)
  const otherNames = [...new Set((history ?? []).map((b) => b.client_name).filter((n) => n && n !== client.name))]

  const mergeCandidates = mq.trim().length >= 2
    ? clients.filter((c) => c.id !== client.id && (c.name.toLowerCase().includes(mq.toLowerCase()) || phoneDigits(c.phone).includes(mq.replace(/\D/g, '') || '§'))).slice(0, 6)
    : []

  async function mergeWith(other) {
    if (!confirm(`Juntar "${other.name}" a "${client.name}"? O histórico passa todo para ${client.name} e a ficha de ${other.name} é apagada.`)) return
    setError('')
    const r1 = await sb.from('bookings').update({ client_id: client.id }).eq('client_id', other.id)
    if (r1.error) return setError(errMsg(r1.error))
    const note = [client.notes, other.notes, `Também marcava como: ${other.name}`].filter(Boolean).join(' | ')
    const r2 = await sb.from('clients').update({
      phone: client.phone ?? other.phone,
      email: client.email ?? other.email,
      tags: [...new Set([...(client.tags ?? []), ...(other.tags ?? [])])],
      notes: note.slice(0, 2000),
      client_since: [client.client_since, other.client_since].filter(Boolean).sort()[0] ?? null,
    }).eq('id', client.id)
    if (r2.error) return setError(errMsg(r2.error))
    await sb.from('clients').delete().eq('id', other.id)
    setMerging(false); setMq(''); reload()
  }

  async function remove() {
    if (!confirm(`Apagar a ficha de ${client.name}? As marcações antigas continuam na agenda, mas deixam de estar ligadas a esta cliente.`)) return
    const { error } = await sb.from('clients').delete().eq('id', client.id)
    if (error) return setError(errMsg(error))
    onClose(); reload()
  }

  return (
    <div className="stack">
      <button className="link back" onClick={onClose}>← Clientes</button>
      {error && <p className="alert">{error}</p>}
      {editing ? (
        <ClientForm salon={salon} client={client} tags={tags} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); reload() }} />
      ) : (
        <section className="card stack">
          <div>
            <h2>{client.name}</h2>
            <span className="muted small">Cliente desde {client.client_since ? fDate(client.client_since) : fDate(client.created_at)}</span>
          </div>
          <div className="stack tight small">
            {client.phone && <span>📱 <a href={`tel:${client.phone}`}>{client.phone}</a></span>}
            {client.email && <span>✉️ <a href={`mailto:${client.email}`}>{client.email}</a></span>}
            {!client.phone && !client.email && <span className="muted">Sem telemóvel nem e-mail.</span>}
          </div>
          {(client.tags ?? []).length > 0 && <span className="tag-line">{client.tags.map((t) => <span key={t} className="tag">{t}</span>)}</span>}
          {client.notes && <p className="note" style={{ margin: 0 }}>{client.notes}</p>}
          <div className="stats">
            <div><strong>{client.visits}</strong><span className="muted small">visitas</span></div>
            <div><strong>{client.last_visit ? fDate(client.last_visit) : '—'}</strong><span className="muted small">última</span></div>
            <div><strong>{client.next_visit ? fDate(client.next_visit) : '—'}</strong><span className="muted small">próxima</span></div>
          </div>
          {top.length > 0 && <span className="small muted">Mais feitos: {top.map(([n, k]) => `${n} (${k})`).join(', ')}</span>}
          {otherNames.length > 0 && <span className="small muted">Também marcou como: {otherNames.join(', ')}</span>}
          <div className="row-actions">
            <button className="btn small primary" onClick={() => onNewBooking(client)}>+ Marcação</button>
            {client.phone && <a className="btn small ghost" target="_blank" rel="noreferrer" href={waLink(client.phone, `Olá ${client.name.split(' ')[0]}! `)}>WhatsApp</a>}
            <button className="btn small ghost" onClick={() => setEditing(true)}>Editar</button>
            <button className="btn small ghost" onClick={() => setMerging(!merging)}>Juntar</button>
            <button className="btn small ghost danger" onClick={remove}>Apagar</button>
          </div>
          {merging && (
            <div className="stack tight">
              <span className="small muted">Juntar outra ficha a esta (ex.: mãe e filha com o mesmo telemóvel, ou cliente repetida):</span>
              <input placeholder="Procurar a outra ficha" value={mq} onChange={(e) => setMq(e.target.value)} autoFocus />
              {mergeCandidates.map((c) => (
                <button key={c.id} className="pick-row" onClick={() => mergeWith(c)}>
                  <strong>{c.name}</strong> <span className="muted small">{c.phone ?? c.email ?? ''} · {c.visits} visitas</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <h3>Histórico</h3>
      {history === null ? (
        <p className="muted">A carregar…</p>
      ) : history.length === 0 ? (
        <p className="empty">Ainda sem marcações.</p>
      ) : (
        <div className="history">
          {history.map((b) => (
            <div key={b.id} className={`hist-row ${b.status}`}>
              <span className="hist-date">{fDate(b.starts_at)}<span className="muted small"> {fTime(b.starts_at)}</span></span>
              <span className="grow">
                {bookingLabel(b)}
                {b.client_name !== client.name && <span className="muted small"> · {b.client_name}</span>}
                {STATUS_PT[b.status] && <span className="muted small"> · {STATUS_PT[b.status]}</span>}
                {new Date(b.starts_at) > new Date() && b.status !== 'cancelled' && b.status !== 'declined' && <span className="small next"> · agendada</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
