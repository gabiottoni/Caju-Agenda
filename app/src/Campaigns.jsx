import { useEffect, useMemo, useState } from 'react'
import { sb, errMsg, fShort, fTime, waNumber } from './lib.js'
import { allTags } from './Clients.jsx'

const PRICE_EUR = 0.05 // ~ preço Meta por mensagem de marketing para números portugueses
const STATUS = {
  draft: ['Rascunho', 'muted'],
  submitted: ['⏳ Em aprovação na Meta', 'pending'],
  approved: ['Aprovada — pronta a enviar', 'ok'],
  sending: ['📤 A enviar', 'ok'],
  sent: ['✓ Enviada', 'ok'],
  rejected: ['Rejeitada pela Meta', 'bad'],
  cancelled: ['Cancelada', 'muted'],
}
const presets = (salon) => {
  const link = `https://agendacaju.com/#/s/${salon.slug}`
  return [
    ['Saudades', `Olá {{nome}}! 🌿 Já há algum tempo que não a vemos no ${salon.name}. Que tal pôr a sobrancelha em dia? Tenho horários livres esta semana: ${link}\n\nUm beijinho 💛`],
    ['Vagas livres', `Olá {{nome}}! Abriram vagas esta semana no ${salon.name} para sobrancelha e buço à linha. Pode marcar diretamente aqui: ${link}\n\nAté já! 🌿`],
    ['Promoção', `Olá {{nome}}! 🎁 Este mês, sobrancelha + buço à linha com preço especial no ${salon.name}. Garanta o seu horário aqui: ${link}\n\nVagas limitadas 💛`],
    ['Agradecimento', `Olá {{nome}}! 💛 Obrigada por confiar no ${salon.name}. Se gostou do resultado, partilhe o link com uma amiga: ${link}\n\nAdoramos receber novas clientes! 🌿`],
  ]
}
const preview = (body, name = 'Ana') => body.replaceAll('{{nome}}', name)
const ageDays = (d) => (d ? (Date.now() - new Date(d).getTime()) / 864e5 : Infinity)

export function CampaignsTab({ salon, clients, reload }) {
  const [list, setList] = useState(null)
  const [stats, setStats] = useState({})
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const { data } = await sb.from('campaigns').select('*').eq('salon_id', salon.id).order('created_at', { ascending: false }).limit(50)
    setList(data ?? [])
    const ids = (data ?? []).map((c) => c.id)
    if (ids.length) {
      const { data: r } = await sb.from('campaign_recipients').select('campaign_id, status').in('campaign_id', ids)
      const s = {}
      for (const x of r ?? []) { s[x.campaign_id] ??= { queued: 0, sent: 0, failed: 0, skipped: 0 }; s[x.campaign_id][x.status]++ }
      setStats(s)
    }
  }
  useEffect(() => { load() }, [salon.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function act(c, action) {
    setBusy(c.id + action); setErr('')
    const { data, error } = await sb.functions.invoke('campaigns', { body: { action, campaign_id: c.id } })
    setBusy('')
    const msg = data?.error ?? (error && (await error.context?.json?.().catch(() => null))?.error) ?? (error && errMsg(error))
    if (msg) setErr(msg)
    load()
  }

  if (!salon.wa_waba_id) return <p className="empty">As campanhas precisam do WhatsApp do salão ligado (como os lembretes automáticos).</p>
  if (creating) return <NewCampaign salon={salon} clients={clients} reload={reload} onCancel={() => setCreating(false)} onDone={() => { setCreating(false); load() }} />
  if (list === null) return <p className="muted">A carregar…</p>

  return (
    <div className="stack">
      <button className="btn primary" onClick={() => setCreating(true)}>+ Nova campanha</button>
      <p className="muted small">
        Envie uma mensagem a um grupo de clientes. Cada mensagem nova vai primeiro <b>para aprovação da Meta</b> (normalmente minutos a 1 dia); quando é aprovada, sai sozinha entre as 10h e as 20h.
        Custo da Meta: cerca de {PRICE_EUR.toFixed(2).replace('.', ',')} € por cliente. Quem responder “NÃO” deixa de receber.
      </p>
      {err && <p className="alert">{err}</p>}
      {list.length === 0 && <p className="empty">Ainda não criou nenhuma campanha.</p>}
      {list.map((c) => {
        const st = stats[c.id] ?? { queued: 0, sent: 0, failed: 0, skipped: 0 }
        const total = st.queued + st.sent + st.failed + st.skipped
        const [label, cls] = STATUS[c.status] ?? [c.status, 'muted']
        return (
          <article key={c.id} className="card stack tight">
            <div className="row-between clickable" onClick={() => setOpen(open === c.id ? null : c.id)}>
              <div>
                <strong>{c.name}</strong>
                <span className="muted small block">{fShort(c.created_at)} · {total} cliente{total === 1 ? '' : 's'}{st.sent ? ` · ${st.sent} enviada${st.sent === 1 ? '' : 's'}` : ''}{st.failed ? ` · ${st.failed} falharam` : ''}</span>
              </div>
              <span className={`small rem ${cls}`}>{label}</span>
            </div>
            {c.status === 'rejected' && <p className="alert small">Motivo da Meta: {c.meta_reason}. Mude o texto (ex.: menos “promoção agressiva”, sem pedir dados) e reenvie.</p>}
            {c.status === 'sending' && st.queued > 0 && <div className="progress"><span style={{ width: `${((total - st.queued) / Math.max(1, total)) * 100}%` }} /></div>}
            {open === c.id && <CampaignDetail c={c} onSaved={load} />}
            <div className="row-actions">
              {c.status === 'draft' && <button className="btn small primary" disabled={!!busy} onClick={() => act(c, 'submit')}>Enviar para aprovação</button>}
              {c.status === 'rejected' && open === c.id && <button className="btn small primary" disabled={!!busy} onClick={() => act(c, 'submit')}>Reenviar para aprovação</button>}
              {c.status === 'rejected' && open !== c.id && <button className="btn small" onClick={() => setOpen(c.id)}>Corrigir texto</button>}
              {c.status === 'submitted' && <button className="btn small ghost" disabled={!!busy} onClick={() => act(c, 'refresh')}>{busy === c.id + 'refresh' ? '…' : 'Ver estado'}</button>}
              {c.status === 'approved' && <button className="btn small primary" disabled={!!busy} onClick={() => act(c, 'send')}>Enviar agora</button>}
              {['submitted', 'approved', 'sending'].includes(c.status) && <button className="btn small ghost danger" disabled={!!busy} onClick={() => confirm('Cancelar esta campanha? As mensagens que ainda não saíram já não são enviadas.') && act(c, 'cancel')}>Cancelar</button>}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function CampaignDetail({ c, onSaved }) {
  const [rows, setRows] = useState(null)
  const [body, setBody] = useState(c.body)
  useEffect(() => { sb.from('campaign_recipients').select('*').eq('campaign_id', c.id).order('name').then(({ data }) => setRows(data ?? [])) }, [c.id])
  const editable = ['draft', 'rejected'].includes(c.status)
  return (
    <div className="stack tight">
      {editable ? (
        <>
          <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          {body !== c.body && <button className="btn small" onClick={async () => { await sb.from('campaigns').update({ body, updated_at: new Date().toISOString() }).eq('id', c.id); onSaved() }}>Guardar texto</button>}
        </>
      ) : <p className="wa-bubble">{preview(c.body)}<span className="wa-foot">Responda NÃO para deixar de receber.</span></p>}
      {rows && (
        <details>
          <summary className="small">Clientes ({rows.length})</summary>
          <div className="history">
            {rows.map((r) => (
              <div key={r.id} className="hist-row">
                <span className="grow">{r.name} <span className="muted small">· {r.phone}</span>{r.error && <span className="small muted block">{r.error}</span>}</span>
                <span className="small muted">{r.status === 'sent' ? `✓ ${fTime(r.sent_at)}` : r.status === 'failed' ? 'falhou' : r.status === 'skipped' ? 'não enviada' : 'na fila'}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function NewCampaign({ salon, clients, reload, onCancel, onDone }) {
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const [since, setSince] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [optOut, setOptOut] = useState(new Set())
  const [body, setBody] = useState('')
  const [sendOnApproval, setSendOnApproval] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [groupName, setGroupName] = useState('')
  const [groupMsg, setGroupMsg] = useState('')
  const tags = useMemo(() => allTags(clients), [clients])

  useEffect(() => { sb.from('client_optouts').select('id').eq('salon_id', salon.id).then(({ data }) => setOptOut(new Set((data ?? []).map((x) => x.id)))) }, [salon.id])

  const reachable = useMemo(() => clients.filter((c) => waNumber(c.phone)?.length >= 11 && !optOut.has(c.id)), [clients, optOut])
  const filtered = reachable.filter((c) => {
    if (tag && !(c.tags ?? []).includes(tag)) return false
    if (since === 'never' && c.visits > 0) return false
    if (since && since !== 'never' && !(c.last_visit && ageDays(c.last_visit) >= Number(since) && !c.next_visit)) return false
    if (q && !c.name.toLowerCase().includes(q.toLowerCase())) return false
    return true
  })
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectAll = () => setPicked((s) => new Set([...s, ...filtered.map((c) => c.id)]))
  const chosen = reachable.filter((c) => picked.has(c.id))

  async function saveGroup() {
    const g = groupName.trim()
    if (!g || !chosen.length) return
    setGroupMsg('A guardar…')
    for (let i = 0; i < chosen.length; i += 20) {
      await Promise.all(chosen.slice(i, i + 20).map((c) => sb.from('clients').update({ tags: [...new Set([...(c.tags ?? []), g])] }).eq('id', c.id)))
    }
    setGroupMsg(`Grupo “${g}” guardado com ${chosen.length} clientes ✓`); setGroupName(''); reload()
  }

  async function create() {
    setErr('')
    const text = body.trim()
    if (!text) return setErr('Escreva a mensagem.')
    if (/^\{\{|\}\}$/.test(text)) return setErr('A mensagem não pode começar nem terminar com o nome. Junte um texto antes/depois.')
    setBusy(true)
    const { data: c, error } = await sb.from('campaigns').insert({ salon_id: salon.id, name: name.trim() || 'Campanha', body: text, send_on_approval: sendOnApproval }).select().single()
    if (error) { setBusy(false); return setErr(errMsg(error)) }
    const recips = chosen.map((x) => ({ campaign_id: c.id, client_id: x.id, name: x.name, phone: waNumber(x.phone) }))
    const uniq = [...new Map(recips.map((r) => [r.phone, r])).values()]
    for (let i = 0; i < uniq.length; i += 500) {
      const { error: e2 } = await sb.from('campaign_recipients').insert(uniq.slice(i, i + 500))
      if (e2) { setBusy(false); return setErr(errMsg(e2)) }
    }
    const { data, error: e3 } = await sb.functions.invoke('campaigns', { body: { action: 'submit', campaign_id: c.id } })
    setBusy(false)
    const msg = data?.error ?? (e3 && (await e3.context?.json?.().catch(() => null))?.error) ?? (e3 && errMsg(e3))
    if (msg) { alert(`A campanha ficou guardada como rascunho, mas a Meta não aceitou o envio: ${msg}`) }
    onDone()
  }

  return (
    <div className="stack">
      <button className="link back" onClick={step === 1 ? onCancel : () => setStep(step - 1)}>← {step === 1 ? 'Campanhas' : 'Voltar'}</button>
      <ol className="steps small"><li className={step === 1 ? 'on' : ''}>Clientes</li><li className={step === 2 ? 'on' : ''}>Mensagem</li><li className={step === 3 ? 'on' : ''}>Rever e enviar</li></ol>
      {err && <p className="alert">{err}</p>}

      {step === 1 && (
        <div className="stack">
          <label>Nome da campanha<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Saudades — novembro" /></label>
          <div className="two">
            <label>Grupo
              <select value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">Todas as clientes</option>
                {tags.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>Última visita
              <select value={since} onChange={(e) => setSince(e.target.value)}>
                <option value="">Qualquer</option>
                <option value="30">Há mais de 1 mês (sem marcação)</option>
                <option value="45">Há mais de 6 semanas (sem marcação)</option>
                <option value="60">Há mais de 2 meses (sem marcação)</option>
                <option value="90">Há mais de 3 meses (sem marcação)</option>
                <option value="180">Há mais de 6 meses (sem marcação)</option>
                <option value="never">Nunca vieram</option>
              </select>
            </label>
          </div>
          <input type="search" placeholder="Procurar cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="row-between">
            <span className="small"><b>{chosen.length}</b> selecionada{chosen.length === 1 ? '' : 's'} · {filtered.length} na lista</span>
            <span className="row-actions">
              <button className="link small" onClick={selectAll}>Selecionar todas</button>
              <button className="link small" onClick={() => setPicked(new Set())}>Limpar</button>
            </span>
          </div>
          <div className="history pick-list">
            {filtered.slice(0, 400).map((c) => (
              <label key={c.id} className="hist-row check">
                <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                <span className="grow">{c.name}<span className="muted small"> · {c.last_visit ? `última ${fShort(c.last_visit)}` : 'sem visitas'}{(c.tags ?? []).length ? ` · ${c.tags.join(', ')}` : ''}</span></span>
              </label>
            ))}
            {filtered.length > 400 && <p className="muted small">… e mais {filtered.length - 400} (use “Selecionar todas” ou filtre)</p>}
          </div>
          <p className="muted small">Só aparecem clientes com telemóvel válido e que não pediram para deixar de receber ({clients.length - reachable.length} ficam de fora).</p>
          {chosen.length > 0 && (
            <div className="inline-form">
              <input placeholder="Guardar seleção como grupo…" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
              <button className="btn small" disabled={!groupName.trim()} onClick={saveGroup}>Guardar grupo</button>
            </div>
          )}
          {groupMsg && <p className="notice small">{groupMsg}</p>}
          <button className="btn primary" disabled={!chosen.length} onClick={() => setStep(2)}>Continuar ({chosen.length})</button>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <span className="small"><b>Modelos prontos</b> (pode editar depois)</span>
          <div className="chips">
            {presets(salon).map(([label, text]) => <button key={label} type="button" className={`chip pick ${body === text ? 'on' : ''}`} onClick={() => setBody(text)}>{label}</button>)}
          </div>
          <label>Mensagem
            <textarea rows={7} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escreva aqui… use {{nome}} para pôr o primeiro nome da cliente." />
          </label>
          <div className="row-between">
            <button type="button" className="link small" onClick={() => setBody((b) => (b.startsWith('Olá') || !b ? `${b}{{nome}}` : `${b} {{nome}}`))}>+ Inserir nome da cliente</button>
            <span className="muted small">{body.length}/1000</span>
          </div>
          {body && <><span className="small muted">Pré-visualização:</span><p className="wa-bubble">{preview(body)}<span className="wa-foot">Responda NÃO para deixar de receber.</span></p></>}
          <p className="muted small">Dicas para a Meta aprovar: tom simpático, sem letras todas maiúsculas, sem pedir dados pessoais, e não começar nem terminar com o nome.</p>
          <button className="btn primary" disabled={!body.trim()} onClick={() => setStep(3)}>Continuar</button>
        </div>
      )}

      {step === 3 && (
        <div className="stack">
          <div className="card stack tight">
            <span><b>{name.trim() || 'Campanha'}</b></span>
            <span className="small">{chosen.length} cliente{chosen.length === 1 ? '' : 's'} · custo estimado ≈ {(chosen.length * PRICE_EUR).toFixed(2).replace('.', ',')} € (cobrado pela Meta no cartão da conta)</span>
          </div>
          <p className="wa-bubble">{preview(body, chosen[0]?.name?.split(' ')[0] ?? 'Ana')}<span className="wa-foot">Responda NÃO para deixar de receber.</span></p>
          <label className="check"><input type="checkbox" checked={sendOnApproval} onChange={(e) => setSendOnApproval(e.target.checked)} /> Enviar automaticamente assim que a Meta aprovar (entre as 10h e as 20h)</label>
          {!sendOnApproval && <p className="muted small">Depois de aprovada, aparece o botão “Enviar agora” na lista de campanhas.</p>}
          <button className="btn primary big" disabled={busy} onClick={create}>{busy ? 'A enviar para a Meta…' : 'Enviar para aprovação da Meta'}</button>
        </div>
      )}
    </div>
  )
}
