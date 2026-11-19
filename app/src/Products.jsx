import { useEffect, useState } from 'react'
import { sb, errMsg, fMoney, fShort, fTime, addDays, startOfDay } from './lib.js'
import { SellForm } from './BookingSheet.jsx'

const cents = (v) => (v === '' || v == null ? null : Math.round(Number(String(v).replace(',', '.')) * 100))
const euros = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','))
const EMPTY = { name: '', price: '', cost: '', stock: '' }

// Separador opcional (Definições → "Vendo produtos"): catálogo, stock e vendas
export function ProductsTab({ salon, clients }) {
  const [products, setProducts] = useState(null)
  const [sales, setSales] = useState([])
  const [f, setF] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [selling, setSelling] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    const since = addDays(startOfDay(new Date()), -30).toISOString()
    const [p, s] = await Promise.all([
      sb.from('products').select('*').eq('salon_id', salon.id).order('active', { ascending: false }).order('name'),
      sb.from('product_sales').select('*').eq('salon_id', salon.id).gte('sold_at', since).order('sold_at', { ascending: false }),
    ])
    setProducts(p.data ?? [])
    setSales(s.data ?? [])
  }
  useEffect(() => { load() }, [salon.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(e) {
    e.preventDefault(); setErr('')
    const row = { name: f.name.trim(), price_cents: cents(f.price), cost_cents: cents(f.cost), stock: f.stock === '' ? null : Number(f.stock) }
    const { error } = editId
      ? await sb.from('products').update(row).eq('id', editId)
      : await sb.from('products').insert({ ...row, salon_id: salon.id })
    if (error) return setErr(errMsg(error))
    setF(EMPTY); setEditId(null); load()
  }
  async function toggle(p) { await sb.from('products').update({ active: !p.active }).eq('id', p.id); load() }
  async function removeSale(s) {
    if (!confirm(`Apagar a venda de ${s.product_name}? O stock é reposto.`)) return
    await sb.from('product_sales').delete().eq('id', s.id); load()
  }

  if (products === null) return <p className="muted">A carregar…</p>
  const clientName = (id) => clients.find((c) => c.id === id)?.name
  const month0 = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const monthSales = sales.filter((s) => new Date(s.sold_at) >= month0)
  const monthTotal = monthSales.reduce((a, s) => a + s.qty * s.unit_price_cents, 0)
  const monthProfit = monthSales.reduce((a, s) => a + s.qty * (s.unit_price_cents - (s.unit_cost_cents ?? 0)), 0)

  if (selling) return <div className="card"><SellForm salon={salon} onCancel={() => setSelling(false)} onSaved={() => { setSelling(false); load() }} /></div>

  return (
    <div className="stack">
      <div className="rev-cards">
        <div className="card"><span className="muted small">Vendas este mês</span><strong>{fMoney(monthTotal)}</strong><span className="small muted">{monthSales.length} venda{monthSales.length === 1 ? '' : 's'}</span></div>
        <div className="card"><span className="muted small">Margem este mês</span><strong>{fMoney(monthProfit)}</strong><span className="small muted">venda − custo</span></div>
      </div>
      <button className="btn primary" onClick={() => setSelling(true)} disabled={!products.some((p) => p.active)}>🛍️ Registar venda</button>

      <form className={`card stack ${editId ? 'editing' : ''}`} onSubmit={save}>
        <h3>{editId ? 'Editar produto' : 'Novo produto'}</h3>
        {err && <p className="alert">{err}</p>}
        <label>Nome<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Sérum de sobrancelhas" /></label>
        <div className="two">
          <label>Preço de venda (€)<input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="0,00" /></label>
          <label>Custo (€)<input inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder="opcional" /></label>
          <label>Stock<input type="number" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} placeholder="opcional" /></label>
        </div>
        <div className="row-actions">
          <button className="btn primary">{editId ? 'Guardar' : 'Adicionar'}</button>
          {editId && <button type="button" className="btn ghost" onClick={() => { setEditId(null); setF(EMPTY) }}>Cancelar</button>}
        </div>
      </form>

      {products.length > 0 && (
        <section className="card stack">
          <h3>Produtos</h3>
          {products.map((p) => (
            <div key={p.id} className={`rev-row ${p.active ? '' : 'muted'}`}>
              <span className="grow">
                {p.name}
                <span className="muted small"> · {p.price_cents != null ? fMoney(p.price_cents) : 'sem preço'}{p.cost_cents != null ? ` · custo ${fMoney(p.cost_cents)}` : ''}</span>
                {p.stock != null && <span className={`small ${p.stock <= 2 ? 'down' : 'muted'}`}> · stock {p.stock}{p.stock <= 2 ? ' (acabar)' : ''}</span>}
              </span>
              <button className="link small" onClick={() => { setEditId(p.id); setF({ name: p.name, price: euros(p.price_cents), cost: euros(p.cost_cents), stock: p.stock ?? '' }); window.scrollTo(0, 0) }}>Editar</button>
              <button className="link small" onClick={() => toggle(p)}>{p.active ? 'Arquivar' : 'Reativar'}</button>
            </div>
          ))}
        </section>
      )}

      <section className="card stack">
        <h3>Vendas dos últimos 30 dias</h3>
        {sales.length === 0 && <p className="muted small">Ainda sem vendas.</p>}
        {sales.map((s) => (
          <div key={s.id} className="rev-row">
            <span className="hist-date">{fShort(s.sold_at)} {fTime(s.sold_at)}</span>
            <span className="grow">{s.product_name}{s.qty > 1 ? ` × ${s.qty}` : ''}{s.client_id && clientName(s.client_id) ? <span className="muted small"> · {clientName(s.client_id)}</span> : null}</span>
            <strong>{fMoney(s.qty * s.unit_price_cents)}</strong>
            <button className="link small danger" aria-label="Apagar venda" onClick={() => removeSale(s)}>×</button>
          </div>
        ))}
      </section>
      <p className="muted small">As vendas entram na Faturação. Registe a compra de stock como gasto variável (“Produtos”) na Faturação.</p>
    </div>
  )
}
