import { useCallback, useEffect, useState } from 'react'
import { sb, addDays, startOfDay } from './lib.js'
import { Onboarding } from './Auth.jsx'
import { BookingsList, NewBooking } from './Bookings.jsx'
import { CalendarView } from './Calendar.jsx'
import { ClientsTab, ClientSheet } from './Clients.jsx'
import { Services, Hours, Blocks, Settings } from './Admin.jsx'
import { InstallHint } from './Push.jsx'
import { RevenueTab } from './Revenue.jsx'
import { MessagesTab } from './Messages.jsx'
import { BookingSheet } from './BookingSheet.jsx'
import { ProductsTab } from './Products.jsx'
import { OfficeTab } from './Office.jsx'

const TABS = [
  ['pending', 'Pedidos'],
  ['agenda', 'Agenda'],
  ['clients', 'Clientes'],
  ['revenue', 'Faturação'],
  ['products', 'Produtos'],
  ['messages', 'Mensagens'],
  ['office', 'Escritório'],
  ['services', 'Serviços'],
  ['hours', 'Horários'],
  ['blocks', 'Bloqueios'],
  ['settings', 'Definições'],
]

async function loadAllClients(salonId) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('client_overview').select('*').eq('salon_id', salonId).order('name').range(from, from + 999)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) return out
  }
}

export default function Panel({ session }) {
  const [salon, setSalon] = useState(undefined)
  const [bookings, setBookings] = useState([])
  const [services, setServices] = useState([])
  const [hours, setHours] = useState([])
  const [blocks, setBlocks] = useState([])
  const [clients, setClients] = useState([])
  const [tab, setTab] = useState('pending')
  const [loadError, setLoadError] = useState('')
  const [clientId, setClientId] = useState(null)
  const [newFor, setNewFor] = useState(undefined) // undefined = fechado; null = sem cliente; objeto = cliente
  const [newAt, setNewAt] = useState(null) // hora escolhida na grelha da agenda
  const [bookingId, setBookingId] = useState(null) // pop-up da marcação

  const load = useCallback(async () => {
    const { data, error } = await sb.from('salons').select('*, services(count)').eq('owner_id', session.user.id).order('created_at')
    if (error) { setLoadError(error.message); return }
    setLoadError('')
    if (!data?.length) { setSalon(null); return }
    // Se houver mais de um salão, abre o que tem mais serviços
    const { services: _c, ...s } = data.reduce((a, b) => ((b.services?.[0]?.count ?? 0) > (a.services?.[0]?.count ?? 0) ? b : a))
    const since = addDays(startOfDay(new Date()), -1).toISOString()
    const [bk, sv, wh, bl, cl] = await Promise.all([
      sb.from('bookings').select('*').eq('salon_id', s.id).in('status', ['pending', 'confirmed']).gte('starts_at', since).order('starts_at'),
      sb.from('services').select('*').eq('salon_id', s.id).order('sort').order('name'),
      sb.from('working_hours').select('*').eq('salon_id', s.id).order('start_time'),
      sb.from('blocks').select('*').eq('salon_id', s.id).gte('ends_at', since).order('starts_at'),
      loadAllClients(s.id).catch(() => null),
    ])
    setBookings(bk.data ?? [])
    setServices(sv.data ?? [])
    setHours(wh.data ?? [])
    setBlocks(bl.data ?? [])
    if (cl) setClients(cl)
    setSalon((prev) => (prev && JSON.stringify(prev) === JSON.stringify(s) ? prev : s))
  }, [session.user.id])

  useEffect(() => { load() }, [load])

  const salonId = salon?.id
  useEffect(() => {
    if (!salonId) return
    const ch = sb.channel('bookings').on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `salon_id=eq.${salonId}` }, () => load()).subscribe()
    const t = setInterval(load, 60000)
    return () => { sb.removeChannel(ch); clearInterval(t) }
  }, [salonId, load])

  const pendingCount = bookings.filter((b) => b.status === 'pending' && new Date(b.ends_at) > new Date()).length
  const [picked, setPicked] = useState(false)
  useEffect(() => {
    if (salon && !picked) { setPicked(true); if (pendingCount === 0) setTab('agenda') }
  }, [salon, picked, pendingCount])

  if (salon === undefined && loadError)
    return (
      <div className="page center">
        <h2>Não foi possível carregar</h2>
        <p className="muted small">Verifique a internet e tente de novo.</p>
        <button className="btn primary" onClick={load}>Tentar de novo</button>
        <button className="link small" onClick={() => sb.auth.signOut()}>Sair</button>
      </div>
    )
  if (salon === undefined) return <div className="page center"><p className="muted">A carregar…</p></div>
  if (salon === null) return <Onboarding email={session.user.email ?? ''} onDone={load} />

  const needsSetup = services.length === 0 || hours.length === 0
  const go = (t) => { setTab(t); setClientId(null); setNewFor(undefined); setNewAt(null) }
  const openClient = (id) => { setTab('clients'); setClientId(id); setNewFor(undefined); window.scrollTo(0, 0) }
  const newBooking = (client) => { setTab('agenda'); setClientId(null); setNewFor(client ?? null); window.scrollTo(0, 0) }

  return (
    <div className="page panel">
      <header className="panel-head">
        <div>
          <p className="eyebrow">Painel</p>
          <h1>{salon.name}</h1>
        </div>
        <button className="link small" onClick={() => sb.auth.signOut()}>Sair</button>
      </header>
      <InstallHint />
      {needsSetup && (
        <p className="notice">
          Para começar: {services.length === 0 && <button className="link" onClick={() => go('services')}>adicione serviços</button>}
          {services.length === 0 && hours.length === 0 && ' e '}
          {hours.length === 0 && <button className="link" onClick={() => go('hours')}>defina horários</button>}.
        </p>
      )}
      <nav className="tabs" role="tablist">
        {TABS.filter(([k]) => (k !== 'products' || salon.sell_products) && (k !== 'office' || salon.slug === 'caju-studio')).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>
            {label}
            {k === 'pending' && pendingCount > 0 && <span className="count">{pendingCount}</span>}
          </button>
        ))}
      </nav>

      {tab === 'agenda' && (
        newFor !== undefined ? (
          <NewBooking salon={salon} services={services} clients={clients} bookings={bookings} presetClient={newFor} presetStart={newAt} onCancel={() => { setNewFor(undefined); setNewAt(null) }} onDone={() => { setNewFor(undefined); setNewAt(null); load() }} />
        ) : (
          <>
            <button className="btn primary small" style={{ marginBottom: 14 }} onClick={() => { setNewAt(null); setNewFor(null) }}>+ Nova marcação</button>
            <CalendarView
              salon={salon}
              hours={hours}
              refreshKey={bookings}
              reload={load}
              openClient={openClient}
              openBooking={setBookingId}
              onNew={(at) => { setNewAt(at); setNewFor(null); window.scrollTo(0, 0) }}
              listView={<BookingsList salon={salon} bookings={bookings} mode="agenda" reload={load} openClient={openClient} openBooking={setBookingId} />}
            />
          </>
        )
      )}
      {tab === 'pending' && <BookingsList salon={salon} bookings={bookings} mode={tab} reload={load} openClient={openClient} openBooking={setBookingId} />}
      {tab === 'clients' && (clientId
        ? <ClientSheet salon={salon} clientId={clientId} clients={clients} reload={load} onClose={() => setClientId(null)} onNewBooking={newBooking} />
        : <ClientsTab salon={salon} clients={clients} reload={load} openClient={openClient} />)}
      {tab === 'revenue' && <RevenueTab salon={salon} services={services} openBooking={setBookingId} />}
      {tab === 'products' && <ProductsTab salon={salon} clients={clients} />}
      {tab === 'office' && <OfficeTab />}
      {tab === 'messages' && <MessagesTab salon={salon} openClient={openClient} clients={clients} reload={load} />}
      {tab === 'services' && <Services salon={salon} services={services} reload={load} />}
      {tab === 'hours' && <Hours salon={salon} hours={hours} reload={load} />}
      {tab === 'blocks' && <Blocks salon={salon} blocks={blocks} reload={load} />}
      {tab === 'settings' && <Settings key={salon.calendar_token + salon.name} salon={salon} reload={load} />}
      {bookingId && <BookingSheet salon={salon} bookingId={bookingId} services={services} reload={load} openClient={openClient} onClose={() => setBookingId(null)} />}
    </div>
  )
}
