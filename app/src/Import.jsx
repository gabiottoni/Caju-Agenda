import { useEffect, useMemo, useState } from 'react'
import { sb, errMsg, fShort, fTime } from './lib.js'

// ---------- leitura do ficheiro ----------
function decode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { return new TextDecoder('windows-1252').decode(buf) }
}
export function parseCsv(text) {
  text = text.replace(/^﻿/, '')
  const first = text.split(/\r?\n/)[0] ?? ''
  const count = (ch) => first.split('"').filter((_, i) => i % 2 === 0).join('').split(ch).length - 1
  const delim = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0]
  const rows = []
  let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim())) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim())) rows.push(row)
  const header = (rows.shift() ?? []).map((h) => h.trim())
  return { header, rows: rows.map((r) => header.map((_, i) => (r[i] ?? '').trim())) }
}

// ---------- normalização ----------
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const pkey = (p) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : null }
const ekey = (e) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e ?? '').trim()) ? String(e).trim().toLowerCase() : null)
const cleanPhone = (p) => {
  let s = String(p ?? '').trim().replace(/\.0$/, '')
  if (!s) return null
  const d = s.replace(/\D/g, '')
  if (d.length < 9) return null
  if (s.startsWith('+')) return '+' + d
  if (d.startsWith('00')) return '+' + d.slice(2)
  if (d.length === 9) return d
  return '+' + d
}
const pad = (n) => String(n).padStart(2, '0')

export function parseDateTime(dateStr, timeStr) {
  let s = String(dateStr ?? '').trim()
  if (!s) return null
  let t = String(timeStr ?? '').trim()
  if (/^\d{5}(\.\d+)?$/.test(s)) { // número de série do Excel
    const ms = Math.round((Number(s) - 25569) * 864e5)
    const d = new Date(ms)
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes())
  }
  let y, m, d, rest = ''
  let mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](.*))?$/)
  if (mt) { [, y, m, d, rest] = mt } else {
    mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ ,T]+(.*))?$/)
    if (!mt) return null
    ;[, d, m, y, rest] = mt
    if (y.length === 2) y = '20' + y
    if (Number(m) > 12 && Number(d) <= 12) [d, m] = [m, d] // formato americano (mm/dd)
  }
  if (!t && rest) t = rest
  let hh = 0, mm = 0
  const tm = t.match(/(\d{1,2})[:h](\d{2})?\s*(am|pm)?/i)
  if (tm) {
    hh = Number(tm[1]); mm = Number(tm[2] ?? 0)
    if (tm[3]?.toLowerCase() === 'pm' && hh < 12) hh += 12
    if (tm[3]?.toLowerCase() === 'am' && hh === 12) hh = 0
  }
  const out = new Date(Number(y), Number(m) - 1, Number(d), hh, mm)
  if (isNaN(out) || out.getMonth() !== Number(m) - 1 || out.getDate() !== Number(d)) return null // ex.: 31/02
  return out
}
function parseBirthday(s) {
  s = String(s ?? '').trim()
  if (!s) return null
  const dm = s.match(/^(\d{1,2})[-/.](\d{1,2})$/)
  if (dm) return `1900-${pad(dm[2])}-${pad(dm[1])}` // sem ano: só conta o dia e o mês
  const d = parseDateTime(s)
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : null
}
export function parseMoney(s) {
  let v = String(s ?? '').replace(/[^\d,.-]/g, '')
  if (!v) return null
  if (v.includes(',') && v.includes('.')) v = v.lastIndexOf(',') > v.lastIndexOf('.') ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '')
  else v = v.replace(',', '.')
  const n = Number(v)
  return isNaN(n) ? null : Math.round(n * 100)
}
export function parseDuration(s) {
  s = String(s ?? '').trim().toLowerCase()
  if (!s) return null
  let m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  m = s.match(/(\d+)\s*h\s*(\d+)?/)
  if (m) return Number(m[1]) * 60 + Number(m[2] ?? 0)
  m = s.match(/(\d+)/)
  return m ? Number(m[1]) : null
}
const cancelled = (s) => /cancel|anulad|no.?show|falt|nao compareceu|recusad|declin/.test(norm(s))

// ---------- campos e palpites de colunas ----------
const FIELDS = {
  clients: [
    ['name', 'Nome', ['nome', 'name', 'cliente', 'client', 'nome completo', 'full name', 'customer']],
    ['first_name', 'Primeiro nome', ['primeiro nome', 'first name', 'firstname', 'nome proprio']],
    ['last_name', 'Apelido', ['apelido', 'sobrenome', 'last name', 'lastname', 'surname']],
    ['phone', 'Telemóvel', ['telemovel', 'telefone', 'phone', 'mobile', 'celular', 'contacto', 'whatsapp', 'tlm', 'numero']],
    ['email', 'E-mail', ['email', 'e mail', 'mail', 'correio']],
    ['birthday', 'Data de nascimento', ['nascimento', 'aniversario', 'birthday', 'birth', 'data nasc', 'dob']],
    ['tags', 'Grupos', ['grupo', 'grupos', 'tags', 'etiquetas', 'categoria']],
    ['notes', 'Notas', ['notas', 'notes', 'observacoes', 'obs', 'comentarios']],
    ['client_since', 'Cliente desde', ['cliente desde', 'criado', 'created', 'registo', 'data de registo', 'since']],
  ],
  bookings: [
    ['datetime', 'Data (e hora)', ['data', 'date', 'dia', 'inicio', 'start', 'data hora', 'data e hora', 'appointment date', 'scheduled']],
    ['time', 'Hora', ['hora', 'time', 'hora inicio', 'start time', 'horario']],
    ['duration', 'Duração', ['duracao', 'duration', 'minutos', 'tempo']],
    ['name', 'Cliente', ['cliente', 'client', 'nome', 'name', 'customer']],
    ['first_name', 'Primeiro nome', ['primeiro nome', 'first name']],
    ['last_name', 'Apelido', ['apelido', 'sobrenome', 'last name']],
    ['phone', 'Telemóvel', ['telemovel', 'telefone', 'phone', 'mobile', 'celular', 'contacto']],
    ['email', 'E-mail', ['email', 'e mail', 'mail']],
    ['service', 'Serviço', ['servico', 'servicos', 'service', 'services', 'tratamento', 'procedimento']],
    ['price', 'Valor (€)', ['preco', 'valor', 'price', 'total', 'montante', 'amount', 'pago']],
    ['status', 'Estado', ['estado', 'status', 'situacao']],
    ['notes', 'Notas', ['notas', 'notes', 'observacoes', 'obs']],
  ],
}
function guess(header, kind) {
  const map = {}
  const used = new Set()
  const H = header.map(norm)
  for (const [key, , words] of FIELDS[kind]) {
    let best = -1
    for (const w of words) { // primeiro correspondência exata, depois parcial
      best = H.findIndex((h, i) => !used.has(i) && h === w)
      if (best >= 0) break
    }
    if (best < 0) for (const w of words) { best = H.findIndex((h, i) => !used.has(i) && h.includes(w)); if (best >= 0) break }
    if (best >= 0) { map[key] = best; used.add(best) }
  }
  // "First Name" apanhado como nome: passa para primeiro nome (o apelido junta-se)
  if (map.name != null && /first|primeiro|proprio/.test(H[map.name]) && map.first_name == null) { map.first_name = map.name; delete map.name }
  return map
}

// ---------- plano de importação (o que vai acontecer) ----------
function buildPlan(kind, data, map, clients, services, existing) {
  const get = (r, k) => (map[k] != null ? r[map[k]] ?? '' : '')
  const byPhone = new Map(), byEmail = new Map(), byName = new Map()
  for (const c of clients) {
    if (c.phone_key) byPhone.set(c.phone_key, c)
    if (c.email_key) byEmail.set(c.email_key, c)
    const n = norm(c.name); if (n && !byName.has(n)) byName.set(n, c)
  }
  const fresh = new Map() // novas clientes deste ficheiro (chave temporária)
  const findClient = (name, phone, email, allowName) =>
    (pkey(phone) && (byPhone.get(pkey(phone)) ?? fresh.get('p' + pkey(phone)))) ||
    (ekey(email) && (byEmail.get(ekey(email)) ?? fresh.get('e' + ekey(email)))) ||
    (allowName && (byName.get(norm(name)) ?? fresh.get('n' + norm(name)))) || null
  const addFresh = (c) => {
    c.tmp = 't' + fresh.size
    if (pkey(c.phone)) fresh.set('p' + pkey(c.phone), c)
    if (ekey(c.email)) fresh.set('e' + ekey(c.email), c)
    fresh.set('n' + norm(c.name), c)
    return c
  }
  const nameOf = (r) => {
    let n = get(r, 'name') || get(r, 'first_name')
    const last = get(r, 'last_name')
    if (last && !norm(n).includes(norm(last))) n = `${n} ${last}`
    return n.replace(/\s+/g, ' ').trim().slice(0, 80)
  }

  const skipped = []
  const updates = new Map()
  const bookings = []

  data.rows.forEach((r, i) => {
    const line = i + 2
    const name = nameOf(r)
    const phone = cleanPhone(get(r, 'phone'))
    const email = ekey(get(r, 'email'))
    if (!name && !phone && !email) return skipped.push({ line, why: 'sem nome nem contacto' })
    const displayName = name || phone || email

    if (kind === 'clients') {
      const tags = get(r, 'tags').split(/[,;|]/).map((t) => t.trim()).filter(Boolean)
      const row = { name: displayName, phone, email, notes: get(r, 'notes').slice(0, 2000) || null, birthday: parseBirthday(get(r, 'birthday')), tags, client_since: parseBirthday(get(r, 'client_since')) }
      const ex = findClient(displayName, phone, email, !phone && !email)
      if (ex && !ex.tmp) {
        const patch = {}
        if (!ex.phone && phone) patch.phone = phone
        if (!ex.email && email) patch.email = email
        if (!ex.notes && row.notes) patch.notes = row.notes
        if (!ex.birthday && row.birthday) patch.birthday = row.birthday
        const t = [...new Set([...(ex.tags ?? []), ...tags])]
        if (t.length !== (ex.tags ?? []).length) patch.tags = t
        if (row.client_since && (!ex.client_since || row.client_since < ex.client_since)) patch.client_since = row.client_since
        if (Object.keys(patch).length) updates.set(ex.id, { ...(updates.get(ex.id) ?? {}), ...patch })
        else skipped.push({ line, why: `já existe (${ex.name})`, quiet: true })
      } else if (ex) skipped.push({ line, why: 'repetida no ficheiro', quiet: true })
      else addFresh(row)
      return
    }

    // marcações
    const start = parseDateTime(get(r, 'datetime'), get(r, 'time'))
    if (!start) return skipped.push({ line, why: `data inválida (“${get(r, 'datetime')}${get(r, 'time') ? ' ' + get(r, 'time') : ''}”)` })
    const svcName = get(r, 'service').trim() || 'Serviço'
    const svc = services.find((s) => norm(s.name) === norm(svcName))
    const dur = parseDuration(get(r, 'duration')) || svc?.duration_min || 30
    const price = (map.price != null ? parseMoney(get(r, 'price')) : null) ?? svc?.price_cents ?? null
    let client = findClient(displayName, phone, email, true)
    if (!client) client = addFresh({ name: displayName, phone, email, notes: null, birthday: null, tags: [], client_since: null })
    const key = `${client.id ?? client.tmp}|${start.getTime()}`
    if (existing.has(`${client.id}|${start.getTime()}`) || existing.has(`${norm(displayName)}|${start.getTime()}`) || bookings.some((b) => b.key === key))
      return skipped.push({ line, why: 'marcação já existe', quiet: true })
    const isCancelled = map.status != null && cancelled(get(r, 'status'))
    bookings.push({
      key, client, start, end: new Date(start.getTime() + dur * 6e4), status: isCancelled ? 'cancelled' : 'confirmed',
      service: { id: svc?.id ?? null, name: svcName.slice(0, 120), duration_min: dur, price_cents: price },
      notes: get(r, 'notes').slice(0, 500) || null, name: displayName, phone, email,
    })
  })
  const newClients = [...new Set(fresh.values())]
  return { newClients, updates, bookings, skipped }
}

const SAMPLES = {
  clients: 'Nome;Telemóvel;E-mail;Data de nascimento;Grupos;Notas\nAna Ribeiro;912345678;ana@exemplo.pt;14/03/1990;VIP;Prefere linha fina\n',
  bookings: 'Data;Hora;Cliente;Telemóvel;Serviço;Valor;Duração;Estado\n15/10/2026;10:30;Ana Ribeiro;912345678;Sobrancelha à linha;12,00;30;Concluída\n',
}
function download(name, text) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  a.download = name; a.click()
}

// ---------- assistente ----------
export function ImportWizard({ salon, clients, reload, onClose }) {
  const [kind, setKind] = useState('clients')
  const [file, setFile] = useState(null) // { name, header, rows }
  const [map, setMap] = useState({})
  const [services, setServices] = useState([])
  const [existing, setExisting] = useState(new Set())
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => { sb.from('services').select('id, name, duration_min, price_cents').eq('salon_id', salon.id).then(({ data }) => setServices(data ?? [])) }, [salon.id])

  async function onFile(e) {
    setErr(''); setResult(null)
    const f = e.target.files?.[0]
    if (!f) return
    if (/\.(xlsx?|numbers)$/i.test(f.name)) return setErr('Esse ficheiro é do Excel/Numbers. Abra-o e use “Guardar como” → CSV, e envie o CSV.')
    const data = parseCsv(decode(await f.arrayBuffer()))
    if (!data.header.length || !data.rows.length) return setErr('Não encontrei dados no ficheiro. A primeira linha tem de ter os nomes das colunas.')
    setFile({ name: f.name, ...data })
    setMap(guess(data.header, kind))
  }
  useEffect(() => { if (file) setMap(guess(file.header, kind)) }, [kind]) // eslint-disable-line react-hooks/exhaustive-deps

  // marcações já existentes no intervalo do ficheiro, para não duplicar
  const range = useMemo(() => {
    if (kind !== 'bookings' || !file || map.datetime == null) return null
    const ds = file.rows.map((r) => parseDateTime(r[map.datetime], map.time != null ? r[map.time] : '')).filter(Boolean)
    if (!ds.length) return null
    return [new Date(Math.min(...ds)), new Date(Math.max(...ds) + 864e5)]
  }, [kind, file, map])
  useEffect(() => {
    if (!range) return setExisting(new Set())
    let alive = true
    ;(async () => {
      const s = new Set()
      for (let from = 0; ; from += 1000) {
        const { data } = await sb.from('bookings').select('client_id, client_name, starts_at').eq('salon_id', salon.id)
          .gte('starts_at', range[0].toISOString()).lte('starts_at', range[1].toISOString()).range(from, from + 999)
        for (const b of data ?? []) { const t = new Date(b.starts_at).getTime(); s.add(`${b.client_id}|${t}`); s.add(`${norm(b.client_name)}|${t}`) }
        if (!data || data.length < 1000) break
      }
      if (alive) setExisting(s)
    })()
    return () => { alive = false }
  }, [range, salon.id])

  const ready = file && (kind === 'clients' ? (map.name != null || map.first_name != null || map.phone != null) : map.datetime != null && (map.name != null || map.first_name != null || map.phone != null))
  const plan = useMemo(() => (ready ? buildPlan(kind, file, map, clients, services, existing) : null), [ready, kind, file, map, clients, services, existing])

  async function run() {
    setErr(''); setProgress('A preparar…')
    try {
      const idOf = new Map()
      // 1) clientes novas
      const nc = plan.newClients
      for (let i = 0; i < nc.length; i += 200) {
        setProgress(`A criar clientes ${Math.min(i + 200, nc.length)}/${nc.length}…`)
        const chunk = nc.slice(i, i + 200)
        const { data, error } = await sb.from('clients').insert(chunk.map((c) => ({
          salon_id: salon.id, name: c.name, phone: c.phone, email: c.email, notes: c.notes, birthday: c.birthday,
          tags: c.tags ?? [], source: 'import', ...(c.client_since ? { client_since: c.client_since } : {}),
        }))).select('id')
        if (error) throw error
        chunk.forEach((c, j) => idOf.set(c.tmp, data[j].id))
      }
      // 2) atualizações de clientes que já existiam
      const ups = [...plan.updates.entries()]
      for (let i = 0; i < ups.length; i += 10) {
        setProgress(`A atualizar clientes ${Math.min(i + 10, ups.length)}/${ups.length}…`)
        await Promise.all(ups.slice(i, i + 10).map(([id, patch]) => sb.from('clients').update(patch).eq('id', id)))
      }
      // 3) marcações
      const bk = plan.bookings
      const now = Date.now()
      for (let i = 0; i < bk.length; i += 200) {
        setProgress(`A importar marcações ${Math.min(i + 200, bk.length)}/${bk.length}…`)
        const { error } = await sb.from('bookings').insert(bk.slice(i, i + 200).map((b) => {
          const future = b.start.getTime() > now
          return {
            salon_id: salon.id, client_id: b.client.id ?? idOf.get(b.client.tmp), client_name: b.name,
            client_phone: b.phone ?? b.client.phone ?? null, client_email: b.email ?? b.client.email ?? null,
            starts_at: b.start.toISOString(), ends_at: b.end.toISOString(), status: b.status,
            cancelled_by: b.status === 'cancelled' ? 'salon' : null,
            services: [b.service], service_id: b.service.id, service_name: b.service.name, notes: b.notes,
            source: 'import', wa_reminder: future && b.status === 'confirmed',
          }
        }))
        if (error) throw error
      }
      setResult({ clients: nc.length, updated: ups.length, bookings: bk.length, future: bk.filter((b) => b.start.getTime() > now && b.status === 'confirmed').length })
      setProgress(null); setFile(null); reload()
    } catch (e) {
      setProgress(null); setErr(`Parou a meio: ${errMsg(e)}. O que já entrou fica guardado; pode voltar a importar o mesmo ficheiro (as repetidas são ignoradas).`)
    }
  }

  const fields = FIELDS[kind]
  const loud = plan?.skipped.filter((s) => !s.quiet) ?? []
  const quiet = plan?.skipped.filter((s) => s.quiet) ?? []
  const fut = plan?.bookings.filter((b) => b.start.getTime() > Date.now() && b.status === 'confirmed') ?? []

  return (
    <section className="card stack">
      <div className="row-between">
        <h3>Importar de outra agenda</h3>
        <button className="link small" onClick={onClose}>Fechar</button>
      </div>
      {result && (
        <p className="notice">
          Importação concluída ✓ {result.clients > 0 && `${result.clients} clientes novas. `}{result.updated > 0 && `${result.updated} clientes completadas. `}
          {result.bookings > 0 && `${result.bookings} marcações (${result.future} futuras, com lembrete automático).`}
        </p>
      )}
      <div className="cal-switch" role="tablist">
        {[['clients', 'Clientes'], ['bookings', 'Histórico de marcações']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>
        ))}
      </div>
      <p className="muted small">
        {kind === 'clients'
          ? 'Exporte a lista de clientes da agenda antiga (Noona, Fresha, Booksy, BloomDesk, Excel…) em CSV. Clientes que já existem (mesmo telemóvel ou e-mail) não se repetem: só completamos o que faltar.'
          : 'Exporte as marcações em CSV: cada linha com data, hora, cliente e serviço. As passadas vão para o histórico e a faturação; as futuras entram na agenda com lembrete. Clientes que não existam são criadas.'}
        {' '}<button className="link small" onClick={() => download(kind === 'clients' ? 'modelo-clientes.csv' : 'modelo-marcacoes.csv', SAMPLES[kind])}>Descarregar modelo</button>
      </p>
      <input type="file" accept=".csv,.txt,text/csv" onChange={onFile} />
      {err && <p className="alert">{err}</p>}

      {file && (
        <>
          <p className="small"><b>{file.name}</b> · {file.rows.length} linhas. Confirme que coluna corresponde a cada campo:</p>
          <div className="map-grid">
            {fields.map(([key, label]) => (
              <label key={key} className="small">{label}
                <select value={map[key] ?? ''} onChange={(e) => setMap({ ...map, [key]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                  <option value="">—</option>
                  {file.header.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`} {file.rows[0]?.[i] ? `(ex.: ${file.rows[0][i].slice(0, 18)})` : ''}</option>)}
                </select>
              </label>
            ))}
          </div>
          {!ready && <p className="alert small">{kind === 'clients' ? 'Escolha pelo menos a coluna do nome ou do telemóvel.' : 'Escolha pelo menos a coluna da data e a do cliente (nome ou telemóvel).'}</p>}

          {plan && (
            <div className="stack tight">
              <div className="import-sum">
                {kind === 'clients' ? (
                  <>
                    <span><b>{plan.newClients.length}</b> clientes novas</span>
                    <span><b>{plan.updates.size}</b> já existiam e vão ser completadas</span>
                    <span className="muted"><b>{quiet.length}</b> iguais (ignoradas)</span>
                  </>
                ) : (
                  <>
                    <span><b>{plan.bookings.length}</b> marcações ({plan.bookings.length - fut.length} passadas/canceladas · <b>{fut.length}</b> futuras)</span>
                    <span><b>{plan.newClients.length}</b> clientes novas a criar</span>
                    <span className="muted"><b>{quiet.length}</b> já estavam na agenda (ignoradas)</span>
                  </>
                )}
                {loud.length > 0 && <span className="down"><b>{loud.length}</b> linhas com problema</span>}
              </div>
              {loud.length > 0 && (
                <details><summary className="small">Ver linhas com problema</summary>
                  <ul className="small">{loud.slice(0, 30).map((s) => <li key={s.line}>Linha {s.line}: {s.why}</li>)}</ul>
                </details>
              )}
              <span className="small muted">Pré-visualização:</span>
              <div className="history">
                {(kind === 'clients' ? plan.newClients.slice(0, 5).map((c) => (
                  <div key={c.tmp} className="hist-row"><span className="grow">{c.name}<span className="muted small"> · {[c.phone, c.email, c.birthday && `🎂 ${c.birthday.slice(8)}/${c.birthday.slice(5, 7)}`, ...(c.tags ?? [])].filter(Boolean).join(' · ')}</span></span></div>
                )) : plan.bookings.slice(0, 6).map((b) => (
                  <div key={b.key} className="hist-row">
                    <span className="hist-date">{fShort(b.start)} {fTime(b.start)}</span>
                    <span className="grow">{b.name}<span className="muted small"> · {b.service.name} · {b.service.duration_min} min{b.service.price_cents != null ? ` · ${(b.service.price_cents / 100).toFixed(2).replace('.', ',')} €` : ''}{b.status === 'cancelled' ? ' · cancelada' : ''}</span></span>
                  </div>
                )))}
              </div>
              {kind === 'bookings' && fut.length > 0 && <p className="muted small">As {fut.length} marcações futuras ficam confirmadas e recebem o lembrete automático. Confira na Agenda se não há horários em cima de outros.</p>}
              <button className="btn primary" disabled={!!progress || (plan.newClients.length + plan.updates.size + plan.bookings.length === 0)} onClick={run}>
                {progress ?? `Importar${kind === 'clients' ? ` ${plan.newClients.length + plan.updates.size} clientes` : ` ${plan.bookings.length} marcações`}`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
