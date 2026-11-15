// Service worker da Agenda: recebe as notificações e abre o painel ao tocar.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { title: 'Agenda', body: event.data?.text() } }
  event.waitUntil(
    self.registration.showNotification(d.title || 'Agenda', {
      body: d.body || '',
      tag: d.tag,
      renotify: true,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: d.url || './#/painel' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || './#/painel', self.registration.scope).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope)) {
          c.navigate(url).catch(() => {})
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
