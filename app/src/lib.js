import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://kptsqanxhhvywzhnqlku.supabase.co'
const SUPABASE_KEY = 'sb_publishable_32YYvWlK8dj1tfAlNdktlQ_nxvF4k_E'
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

export function notify(body) {
  sb.functions.invoke('notify', { body }).catch((e) => console.warn('notify falhou', e))
}

export function errMsg(e) {
  const m = e?.message ?? String(e)
  if (m.includes('Invalid login')) return 'E-mail ou palavra-passe incorretos.'
  if (m.includes('Email not confirmed')) return 'Confirme primeiro o e-mail (veja a sua caixa de entrada).'
  if (m.includes('duplicate key') && m.includes('slug')) return 'Este endereço já está a ser usado. Escolha outro.'
  if (m.includes('client_email_check')) return 'E-mail inválido.'
  if (m.includes('contact_check')) return 'Indique o telemóvel ou o e-mail.'
  return m
}

// ---------- datas ----------
export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
export const WD_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
export const pad = (n) => String(n).padStart(2, '0')
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
export const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime()
export const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const atMin = (d, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60)
const fmt = (o) => new Intl.DateTimeFormat('pt-PT', o)
export const fDay = (d) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d))
export const fShort = (d) => fmt({ day: 'numeric', month: 'short' }).format(new Date(d))
export const fDate = (d) => fmt({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d))
export const fTime = (d) => fmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(d))
export const fDayTime = (d) => `${fDay(d)}, ${fTime(d)}`
export const fMoney = (c) => (c == null ? '' : new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(c / 100))
export const fDur = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`)

export function openDays(hours, maxDays, now = new Date()) {
  const wd = new Set(hours.map((h) => h.weekday))
  const out = []
  for (let i = 0; i <= maxDays; i++) {
    const d = addDays(startOfDay(now), i)
    if (wd.has(d.getDay())) out.push(d)
  }
  return out
}

export function freeSlots({ day, hours, durationMin, stepMin, busy, minNoticeHours, now = new Date() }) {
  const earliest = now.getTime() + minNoticeHours * 36e5
  const taken = busy.map((b) => [new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()])
  const out = []
  for (const h of hours.filter((h) => h.weekday === day.getDay())) {
    const a = toMin(h.start_time)
    const z = toMin(h.end_time)
    for (let m = a; m + durationMin <= z; m += stepMin) {
      const s = atMin(day, m).getTime()
      const e = s + durationMin * 6e4
      if (s < earliest || taken.some(([x, y]) => x < e && y > s)) continue
      out.push(new Date(s))
    }
  }
  return out.sort((x, y) => x - y)
}

export function googleCalUrl(text, start, end, details = '', location = '') {
  const f = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: 'TEMPLATE', text, dates: `${f(start)}/${f(end)}`, details, location })}`
}

export const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

// ---------- clientes ----------
export const phoneDigits = (p) => (p ?? '').replace(/\D/g, '')
export function waNumber(phone) {
  let n = phoneDigits(phone)
  if (n.length === 9) n = '351' + n
  return n
}
export const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`
export const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)
export const validPhone = (p) => phoneDigits(p).length >= 9

// nomes dos serviços de uma marcação (aceita o formato antigo)
export const bookingServices = (b) => (Array.isArray(b.services) && b.services.length ? b.services : [{ id: b.service_id, name: b.service_name }])
export const bookingLabel = (b) => b.service_name || bookingServices(b).map((s) => s.name).join(' + ')

// link do Google Maps do salão (o definido nas Definições ou a partir da morada)
export const mapsLink = (salon) =>
  salon?.maps_url || (salon?.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(salon.address)}` : '')

// .ics da marcação da cliente (para pôr na agenda dela — iPhone, Outlook, Android)
export const clientIcsUrl = (token) => `${SUPABASE_URL}/functions/v1/calendar-feed?m=${token}`
