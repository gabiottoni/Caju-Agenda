import { useEffect, useState } from 'react'
import { sb, fShort, fTime, fDay, bookingLabel } from './lib.js'
import { CampaignsTab } from './Campaigns.jsx'

const STATUS = {
  sent: ['Enviado ✓', 'ok'],
  failed: ['Falhou', 'bad'],
  skipped: ['Não enviado', 'muted'],
}

// Histórico dos lembretes automáticos por WhatsApp + os que estão programados
export function MessagesTab({ salon, openClient, clients, reload }) {
  const [sub, setSub] = useState(() => { try { return localStorage.getItem('caju.msgTab') || 'reminders' } catch { return 'reminders' } })
  const pick = (k) => { setSub(k); try { localStorage.setItem('caju.msgTab', k) } catch { /* */ } }
  return (
    <div className="stack">
      <div className="cal-switch" role="tablist">
        {[['reminders', 'Lembretes'], ['campaigns', 'Campanhas']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>
        ))}
      </div>
      {sub === 'campaigns' ? <CampaignsTab salon={salon} clients={clients} reload={reload} /> : <Reminders salon={salon} openClient={openClient} />}
    </div>
  )
}

function Reminders({ salon, openClient }) {
  const [sent, setSent] = useState(null)
  const [next, setNext] = useState([])

  useEffect(() => {
    const since = new Date(Date.now() - 90 * 864e5).toISOString()
    sb.from('bookings').select('id, client_id, client_name, client_phone, starts_at, service_name, services, reminder_sent_at, wa_reminder_status, wa_reminder_error, status')
      .eq('salon_id', salon.id).not('reminder_sent_at', 'is', null).gte('reminder_sent_at', since)
      .order('reminder_sent_at', { ascending: false }).limit(300)
      .then(({ data }) => setSent(data ?? []))
    sb.from('bookings').select('id, client_id, client_name, client_phone, starts_at, service_name, services')
      .eq('salon_id', salon.id).eq('status', 'confirmed').eq('wa_reminder', true).is('reminder_sent_at', null)
      .not('client_phone', 'is', null).gt('starts_at', new Date().toISOString())
      .order('starts_at').limit(50)
      .then(({ data }) => setNext(data ?? []))
  }, [salon.id])

  if (!salon.wa_phone_number_id) return <p className="empty">Os lembretes por WhatsApp ainda não estão ligados a este salão.</p>
  if (sent === null) return <p className="muted">A carregar…</p>

  const total = sent.filter((m) => m.wa_reminder_status === 'sent').length
  const failed = sent.filter((m) => m.wa_reminder_status === 'failed').length
  const sendAt = (b) => new Date(new Date(b.starts_at).getTime() - salon.wa_reminder_hours * 36e5)

  return (
    <div className="stack">
      {!salon.wa_reminders_enabled && (
        <p className="notice small">Os lembretes automáticos estão <b>desligados</b>. Ligue-os em Definições → Lembretes automáticos por WhatsApp.</p>
      )}
      <p className="muted small">Últimos 90 dias: <b>{total}</b> enviado{total === 1 ? '' : 's'}{failed > 0 && <> · <b>{failed}</b> falhou</>}. Mostra os lembretes automáticos; as mensagens que envia à mão pelo botão WhatsApp não ficam aqui.</p>

      {salon.wa_reminders_enabled && next.length > 0 && (
        <section className="stack tight">
          <h3>Programados</h3>
          <div className="history">
            {next.map((b) => (
              <div key={b.id} className="hist-row">
                <span className="hist-date">{fShort(sendAt(b))}<span className="muted small"> {fTime(sendAt(b))}</span></span>
                <span className="grow">
                  <button className="link name-link" onClick={() => b.client_id && openClient(b.client_id)}>{b.client_name}</button>
                  <span className="muted small"> · {bookingLabel(b)} · {fDay(b.starts_at)} {fTime(b.starts_at)}</span>
                </span>
              </div>
            ))}
          </div>
          <span className="muted small">Hora aproximada; só sai entre as 9h e as 21h.</span>
        </section>
      )}

      <section className="stack tight">
        <h3>Enviados</h3>
        {sent.length === 0 ? (
          <p className="empty">Ainda nenhum lembrete enviado.</p>
        ) : (
          <div className="history">
            {sent.map((m) => {
              const [label, cls] = STATUS[m.wa_reminder_status] ?? ['—', 'muted']
              return (
                <div key={m.id} className="hist-row">
                  <span className="hist-date">{fShort(m.reminder_sent_at)}<span className="muted small"> {fTime(m.reminder_sent_at)}</span></span>
                  <span className="grow">
                    <button className="link name-link" onClick={() => m.client_id && openClient(m.client_id)}>{m.client_name}</button>
                    <span className="muted small"> · lembrete de {fDay(m.starts_at)} {fTime(m.starts_at)}</span>
                    {m.wa_reminder_error && <span className="small muted block">{m.wa_reminder_error}</span>}
                  </span>
                  <span className={`small rem ${cls}`}>{label}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
