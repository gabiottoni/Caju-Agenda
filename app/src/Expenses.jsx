import { useState } from 'react'
import { sb, errMsg, fMoney, fShort, isoDate } from './lib.js'

const CATS = {
  fixed: ['Aluguel', 'Internet', 'Agenda / software', 'Luz', 'Água', 'Telemóvel', 'Contabilidade', 'Seguro', 'Segurança Social', 'Outro'],
  variable: ['Produtos', 'Material descartável', 'Anúncios / marketing', 'Transporte', 'Formação', 'Equipamento', 'Outro'],
}
const cents = (v) => Math.round(Number(String(v).replace(',', '.')) * 100)
const euros = (c) => (c / 100).toFixed(2).replace('.', ',')
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1)
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }

// Soma dos gastos num período [from, to). Fixos são mensais e contam
// proporcionalmente aos dias do período em cada mês em que estão ativos.
export function expensesIn(list, from, to) {
  let fixed = 0
  let variable = 0
  for (const e of list) {
    if (e.kind === 'variable') {
      const d = parseDay(e.spent_on)
      if (d >= from && d < to) variable += e.amount_cents
      continue
    }
    const startM = monthStart(parseDay(e.spent_on))
    const endM = e.ends_on ? monthStart(parseDay(e.ends_on)) : null
    for (let m = monthStart(from); m < to; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      if (m < startM || (endM && m >= endM)) continue
      const next = new Date(m.getFullYear(), m.getMonth() + 1, 1)
      const days = Math.round((next - m) / 864e5)
      const a = from > m ? from : m
      const z = to < next ? to : next
      const overlap = Math.max(0, Math.round((z - a) / 864e5))
      fixed += (e.amount_cents * overlap) / days
    }
  }
  fixed = Math.round(fixed)
  return { fixed, variable, total: fixed + variable }
}

const isActive = (e, from, to) => {
  if (e.kind === 'variable') { const d = parseDay(e.spent_on); return d >= from && d < to }
  return monthStart(parseDay(e.spent_on)) < to && (!e.ends_on || monthStart(parseDay(e.ends_on)) > monthStart(from))
}

export function ExpensesSection({ salon, expenses, from, to, period, reload }) {
  const blank = (kind = 'fixed') => ({ kind, category: '', description: '', amount: '', day: isoDate(new Date()) })
  const [f, setF] = useState(null) // null = fechado
  const [editId, setEditId] = useState(null)
  const [err, setErr] = useState('')

  const fixed = expenses.filter((e) => e.kind === 'fixed' && isActive(e, from, to))
  const variable = expenses.filter((e) => e.kind === 'variable' && isActive(e, from, to))
  const monthlyFixed = fixed.reduce((a, e) => a + e.amount_cents, 0)

  async function save(e) {
    e.preventDefault(); setErr('')
    const amount = cents(f.amount)
    if (!(amount >= 0)) return setErr('Indique o valor.')
    const day = f.kind === 'fixed' ? `${f.day.slice(0, 7)}-01` : f.day
    const row = { kind: f.kind, category: f.category.trim() || 'Outro', description: f.description.trim() || null, amount_cents: amount, spent_on: day }
    const { error } = editId
      ? await sb.from('expenses').update(row).eq('id', editId)
      : await sb.from('expenses').insert({ ...row, salon_id: salon.id })
    if (error) return setErr(errMsg(error))
    setF(null); setEditId(null); reload()
  }
  async function stop(e) {
    const next = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
    if (!confirm(`Deixar de contar "${e.category}" a partir de ${new Intl.DateTimeFormat('pt-PT', { month: 'long' }).format(next)}? Os meses anteriores continuam a contar.`)) return
    await sb.from('expenses').update({ ends_on: isoDate(next) }).eq('id', e.id); reload()
  }
  async function remove(e) {
    if (!confirm(`Apagar "${e.category}"${e.kind === 'fixed' ? ' de todos os meses' : ''}?`)) return
    await sb.from('expenses').delete().eq('id', e.id); reload()
  }
  const edit = (e) => { setEditId(e.id); setF({ kind: e.kind, category: e.category, description: e.description ?? '', amount: euros(e.amount_cents), day: e.spent_on }) }

  return (
    <section className="card stack">
      <div className="row-between">
        <h3>Gastos</h3>
        {!f && <button className="btn small primary" onClick={() => { setEditId(null); setF(blank()) }}>+ Gasto</button>}
      </div>

      {f && (
        <form className="stack tight expense-form" onSubmit={save}>
          {err && <p className="alert">{err}</p>}
          <div className="cal-switch" role="tablist">
            {[['fixed', 'Fixo (todo o mês)'], ['variable', 'Variável']].map(([k, l]) => (
              <button type="button" key={k} role="tab" aria-selected={f.kind === k} className={f.kind === k ? 'on' : ''} onClick={() => setF({ ...f, kind: k })}>{l}</button>
            ))}
          </div>
          <div className="chips">
            {CATS[f.kind].map((c) => <button type="button" key={c} className={`chip pick ${f.category === c ? 'on' : ''}`} onClick={() => setF({ ...f, category: c })}>{c}</button>)}
          </div>
          <div className="two">
            <label>Categoria<input required value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Ex.: Aluguel" /></label>
            <label>Valor (€){f.kind === 'fixed' && <span className="muted"> por mês</span>}<input required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0,00" /></label>
            {f.kind === 'fixed'
              ? <label>A contar desde<input type="month" required value={f.day.slice(0, 7)} onChange={(e) => setF({ ...f, day: `${e.target.value}-01` })} /></label>
              : <label>Dia<input type="date" required value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></label>}
            <label>Descrição<input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={f.kind === 'fixed' ? 'Ex.: renda do espaço' : 'Ex.: linhas e pinças'} /></label>
          </div>
          <div className="row-actions">
            <button className="btn primary">{editId ? 'Guardar' : 'Adicionar'}</button>
            <button type="button" className="btn ghost" onClick={() => { setF(null); setEditId(null) }}>Cancelar</button>
          </div>
        </form>
      )}

      <h4 className="small">Fixos <span className="muted">· {fMoney(monthlyFixed)}/mês{period !== 'month' && fixed.length ? ' (conta a parte proporcional dos dias)' : ''}</span></h4>
      {fixed.length === 0 && <p className="muted small">Ex.: aluguel, internet, agenda…</p>}
      {fixed.map((e) => (
        <div key={e.id} className="exp-row">
          <div className="exp-main">
            <span className="grow">{e.category}{e.description && <span className="muted small"> · {e.description}</span>}{e.ends_on && <span className="muted small"> · até {new Intl.DateTimeFormat('pt-PT', { month: 'short', year: 'numeric' }).format(new Date(parseDay(e.ends_on) - 864e5))}</span>}</span>
            <strong>{fMoney(e.amount_cents)}</strong>
          </div>
          <div className="exp-actions">
            <button className="link small" onClick={() => edit(e)}>Editar</button>
            {!e.ends_on && <button className="link small" onClick={() => stop(e)}>Terminar</button>}
            <button className="link small danger" onClick={() => remove(e)}>Apagar</button>
          </div>
        </div>
      ))}

      <h4 className="small">Variáveis <span className="muted">· {fMoney(variable.reduce((a, e) => a + e.amount_cents, 0))} neste período</span></h4>
      {variable.length === 0 && <p className="muted small">Ex.: produtos, material, anúncios…</p>}
      {variable.map((e) => (
        <div key={e.id} className="exp-row">
          <div className="exp-main">
            <span className="grow"><span className="muted small">{fShort(parseDay(e.spent_on))} · </span>{e.category}{e.description && <span className="muted small"> · {e.description}</span>}</span>
            <strong>{fMoney(e.amount_cents)}</strong>
          </div>
          <div className="exp-actions">
            <button className="link small" onClick={() => edit(e)}>Editar</button>
            <button className="link small danger" onClick={() => remove(e)}>Apagar</button>
          </div>
        </div>
      ))}
    </section>
  )
}
