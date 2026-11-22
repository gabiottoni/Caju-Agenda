import { useEffect, useState } from 'react'
import { sb, errMsg } from './lib.js'

// Separador "Escritório": propostas dos agentes do Caju Office à espera de aprovação
// e o último relatório do analyst. Nada é publicado sem "Aprovar".
const ESTADO = { pendente: 'À espera da sua decisão', aprovado: 'Aprovada', alterar: 'Pediu mudanças', recusado: 'Recusada' }
const n = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-PT'))

export function OfficeTab() {
  const [d, setD] = useState(null)
  const [erro, setErro] = useState('')
  const load = () => sb.rpc('escritorio_painel').then(({ data, error }) => (error ? setErro(errMsg(error)) : setD(data)))
  useEffect(() => { load() }, [])
  if (erro) return <p className="alert">{erro}</p>
  if (!d) return <p className="muted">A carregar…</p>
  const pend = d.aprovacoes.filter((a) => a.estado === 'pendente')
  const resto = d.aprovacoes.filter((a) => a.estado !== 'pendente')
  const agenda = d.semanas.filter((s) => s.fonte === 'agenda')
  return (
    <div className="stack">
      <section className="card stack">
        <h3>Para aprovar {pend.length > 0 && <span className="count">{pend.length}</span>}</h3>
        {pend.length === 0 && <p className="muted small">Nada à espera de si.</p>}
        {pend.map((a) => <Proposta key={a.id} a={a} onDone={load} />)}
      </section>

      {d.relatorio && (
        <section className="card stack">
          <h3>Relatório da semana de {new Date(d.relatorio.semana).toLocaleDateString('pt-PT')}</h3>
          <p>{d.relatorio.resumo}</p>
          {(d.relatorio.recomendacoes || []).map((r, i) => <p key={i} className="small">• {r.acao} <span className="muted">({r.numero_que_justifica})</span></p>)}
        </section>
      )}

      <section className="card stack">
        <h3>Marcações pela agenda, por semana</h3>
        <table className="office-table">
          <thead><tr><th>Semana</th><th>Marcações</th><th>Clientes novas</th><th>Canceladas</th></tr></thead>
          <tbody>
            {agenda.map((s) => (
              <tr key={s.semana}><td>{new Date(s.semana).toLocaleDateString('pt-PT')}</td><td>{n(s.marcacoes)}</td><td><b>{n(s.clientes_novas)}</b></td><td>{n(s.canceladas)}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Meta até 31/12: 15–20 clientes novas.</p>
      </section>

      {resto.length > 0 && (
        <section className="card stack">
          <h3>Histórico</h3>
          {resto.map((a) => (
            <p key={a.id} className="small">{a.experimento?.codigo ?? a.tipo} — <b>{ESTADO[a.estado] ?? a.estado}</b>{a.resposta_gabi && <> · “{a.resposta_gabi}”</>}</p>
          ))}
        </section>
      )}
    </div>
  )
}

function Proposta({ a, onDone }) {
  const [nota, setNota] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState('')
  const e = a.experimento ?? {}
  async function responder(decisao) {
    setErro('')
    if (decisao === 'alterar' && !nota.trim()) return setErro('Escreva o que quer mudar.')
    setBusy(true)
    const { error } = await sb.rpc('escritorio_responder', { p_aprovacao: a.id, p_decisao: decisao, p_comentario: nota.trim() || null })
    setBusy(false)
    if (error) return setErro(errMsg(error))
    onDone()
  }
  return (
    <div className="stack office-prop">
      <p className="eyebrow">{e.codigo} · {e.plataforma} · {e.servico}</p>
      <p><b>Hipótese:</b> {e.hipotese}</p>
      <p className="small"><b>Variantes:</b> {e.angulo}</p>
      <p className="small"><b>Orçamento:</b> €{e.orcamento_eur ?? '—'} · <b>Como decidimos:</b> {e.criterio_sucesso}</p>
      {(a.criativos || []).map((c) => (
        <details key={c.variante} className="office-ad">
          <summary>Variante {c.variante} — {c.qualidade_estado === 'aprovado' ? 'passou na qualidade' : 'tem erros de qualidade'}</summary>
          <ul className="small">
            {(c.conteudo?.titulos || []).map((t, i) => <li key={'t' + i}>{t.texto} <span className="muted">· {t.evidencia === 'hipotese' ? 'hipótese em teste' : t.evidencia === 'base_conhecimento' ? 'facto' : 'pesquisa'}</span></li>)}
          </ul>
          <ul className="small">
            {(c.conteudo?.descricoes || []).map((t, i) => <li key={'d' + i}>{t.texto}</li>)}
          </ul>
          {(c.qualidade_erros || []).length > 0 && <p className="small muted">{c.qualidade_erros.join(' · ')}</p>}
        </details>
      ))}
      <label className="small">Comentário (obrigatório para pedir mudanças)
        <textarea rows={2} value={nota} onChange={(ev) => setNota(ev.target.value)} />
      </label>
      {erro && <p className="alert">{erro}</p>}
      <div className="row-actions">
        <button disabled={busy} onClick={() => responder('aprovado')}>Aprovar</button>
        <button disabled={busy} className="ghost" onClick={() => responder('alterar')}>Pedir mudanças</button>
        <button disabled={busy} className="link" onClick={() => responder('recusado')}>Recusar</button>
      </div>
      <p className="muted small">Aprovar não publica nada sozinho: o anúncio é criado no Google Ads e confirmado consigo antes de gastar.</p>
    </div>
  )
}
