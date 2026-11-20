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
export function loadGoogleTag(tagId) {
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
