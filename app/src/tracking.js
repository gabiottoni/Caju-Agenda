// Medição de anúncios (Google) na página de marcação de cada salão.
// Só carrega depois de a visitante aceitar os cookies (RGPD / Lei 41/2004).
// Nunca enviamos nome, telemóvel ou e-mail para o Google.

const KEY = 'cookies_v1' // 'granted' | 'denied'

export function getConsent() {
  try { return localStorage.getItem(KEY) } catch { return null }
}

export function setConsent(v) {
  try { localStorage.setItem(KEY, v) } catch {}
}

let loadedId = null

// Carrega a etiqueta Google do salão (ID "GTM-…", "G-…" ou "AW-…") com o Consent Mode v2.
export function loadGoogleTag(tagId, adsSendTo) {
  if (!tagId || loadedId === tagId) return
  if (!/^(GTM|G|AW|GT)-[A-Z0-9]+$/i.test(tagId)) return
  loadedId = tagId
  window.dataLayer = window.dataLayer || []
  window.gtag = function () { window.dataLayer.push(arguments) }
  window.gtag('consent', 'default', {
    ad_storage: 'granted', analytics_storage: 'granted',
    ad_user_data: 'granted', ad_personalization: 'denied',
  })
  window.gtag('js', new Date())
  if (!/^GTM-/i.test(tagId)) window.gtag('config', tagId)
  const s = document.createElement('script')
  s.async = true
  s.src = /^GTM-/i.test(tagId)
    ? `https://www.googletagmanager.com/gtm.js?id=${tagId}`
    : `https://www.googletagmanager.com/gtag/js?id=${tagId}`
  document.head.appendChild(s)
  // A conversão do Google Ads ("AW-…/etiqueta") precisa da etiqueta AW- carregada.
  // Com um contentor GTM- carregamos também o gtag.js do AW-, que lê o mesmo dataLayer.
  const aw = /^(AW-\d+)\//i.exec(adsSendTo || '')?.[1]
  if (aw && aw.toUpperCase() !== tagId.toUpperCase()) {
    window.gtag('config', aw)
    const a = document.createElement('script')
    a.async = true
    a.src = `https://www.googletagmanager.com/gtag/js?id=${aw}`
    document.head.appendChild(a)
  }
}

// Evento para o Google (só se a etiqueta estiver carregada).
export function track(event, params = {}) {
  if (!loadedId || typeof window.gtag !== 'function') return
  window.gtag('event', event, params)
}

// Conversão do Google Ads ("AW-123456789/AbCdEf") — opcional, por salão.
export function trackConversion(sendTo, value) {
  if (!loadedId || !sendTo || typeof window.gtag !== 'function') return
  window.gtag('event', 'conversion', { send_to: sendTo, value: value ?? undefined, currency: 'EUR' })
}

// ---------- Umami (self-hosted, sem cookies — não precisa de consentimento) ----------
const UMAMI_SRC = 'https://dados.agendacaju.com/script.js'
let umamiId = null
const umamiQueue = []

export function loadUmami(websiteId, path) {
  if (!websiteId || umamiId) return
  if (!/^[0-9a-f-]{36}$/i.test(websiteId)) return
  umamiId = websiteId
  const s = document.createElement('script')
  s.defer = true
  s.src = UMAMI_SRC
  s.dataset.websiteId = websiteId
  s.dataset.autoTrack = 'false' // a app usa rotas #/, por isso as visitas são registadas à mão
  s.onload = () => {
    window.umami?.track((p) => ({ ...p, url: path, title: document.title }))
    while (umamiQueue.length) window.umami?.track(...umamiQueue.shift())
  }
  document.head.appendChild(s)
}

// Evento sem dados pessoais (nunca nome, telemóvel ou e-mail).
export function umamiEvent(name, data) {
  if (!umamiId) return
  if (window.umami) window.umami.track(name, data)
  else umamiQueue.push([name, data])
}
