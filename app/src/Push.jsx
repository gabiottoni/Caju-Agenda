import { useEffect, useState } from 'react'
import { sb, errMsg } from './lib.js'

const VAPID_PUBLIC = 'BHw8AUqc_sHfQtiWw6aJ-zdk1pYkSoKDJIYeBt06uaWPFtfZBIp5TQ0V30aE3fSWSmhH91A-Zx8YgTtlgqcQVg8'

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function b64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

function deviceName() {
  const ua = navigator.userAgent
  if (/iphone/i.test(ua)) return 'iPhone'
  if (/ipad/i.test(ua)) return 'iPad'
  if (/android/i.test(ua)) return 'Android'
  if (/mac/i.test(ua)) return 'Mac'
  if (/windows/i.test(ua)) return 'Windows'
  return 'Navegador'
}

export function PushCard({ salon }) {
  const [state, setState] = useState('loading') // loading | off | on | denied | unsupported | ios-install
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      if (isIOS() && !isStandalone()) return setState('ios-install')
      if (!supported()) return setState('unsupported')
      if (Notification.permission === 'denied') return setState('denied')
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      setState(sub ? 'on' : 'off')
    })().catch(() => setState('unsupported'))
  }, [])

  async function enable() {
    setBusy(true); setError(''); setMsg('')
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); return }
      const reg = await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(VAPID_PUBLIC) }))
      const j = sub.toJSON()
      const { error } = await sb.from('push_subscriptions').upsert({ salon_id: salon.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: deviceName() }, { onConflict: 'endpoint' })
      if (error) throw error
      setState('on')
      await test()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true); setError('')
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
    setBusy(false); setState('off'); setMsg('')
  }

  async function test() {
    setMsg('')
    const { error } = await sb.functions.invoke('push-notify', { body: { test: true, salon_id: salon.id } })
    if (error) setError(errMsg(error))
    else setMsg('Enviámos uma notificação de teste para este aparelho.')
  }

  return (
    <section className="card stack">
      <h3>🔔 Notificações neste aparelho</h3>
      <p className="muted small">Receba um aviso no telemóvel quando uma cliente pede, cancela ou remarca — mesmo com a agenda fechada.</p>
      {error && <p className="alert">{error}</p>}
      {msg && <p className="notice">{msg}</p>}
      {state === 'loading' && <p className="muted small">A verificar…</p>}
      {state === 'ios-install' && (
        <div className="stack tight small">
          <strong>No iPhone, primeiro instale a agenda como app:</strong>
          <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Abra agendacaju.com no <b>Safari</b>.</li>
            <li>Toque em <b>Partilhar</b> (o quadrado com a seta ↑).</li>
            <li>Escolha <b>“Adicionar ao ecrã principal”</b> → <b>Adicionar</b>.</li>
            <li>Abra a <b>Agenda</b> pelo ícone novo, entre e volte aqui para ativar.</li>
          </ol>
        </div>
      )}
      {state === 'unsupported' && <p className="muted small">Este navegador não suporta notificações. No Android use o Chrome; no iPhone, instale a agenda no ecrã principal pelo Safari.</p>}
      {state === 'denied' && <p className="muted small">As notificações estão bloqueadas para este site. Ative-as nas definições do navegador/telemóvel (Notificações → Agenda) e volte a abrir.</p>}
      {state === 'off' && <button className="btn primary" disabled={busy} onClick={enable}>{busy ? 'A ativar…' : 'Ativar notificações'}</button>}
      {state === 'on' && (
        <div className="row-actions">
          <span className="tag" style={{ alignSelf: 'center' }}>Ativas ✓</span>
          <button className="btn small ghost" onClick={test}>Enviar teste</button>
          <button className="btn small ghost danger" disabled={busy} onClick={disable}>Desativar</button>
        </div>
      )}
    </section>
  )
}

// Faixa discreta no topo do painel para instalar a agenda como app
export function InstallHint() {
  const [prompt, setPrompt] = useState(null)
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('installHint') === 'no' } catch { return false } })
  useEffect(() => {
    const h = (e) => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])
  if (hidden || isStandalone()) return null
  const close = () => { setHidden(true); try { localStorage.setItem('installHint', 'no') } catch {} }
  if (prompt)
    return (
      <p className="notice small">
        📲 Instale a agenda como app neste aparelho.{' '}
        <button className="link" onClick={async () => { prompt.prompt(); await prompt.userChoice; setPrompt(null); close() }}>Instalar</button>{' · '}
        <button className="link" onClick={close}>agora não</button>
      </p>
    )
  if (isIOS())
    return (
      <p className="notice small">
        📲 Para ter a agenda como app: no Safari toque em <b>Partilhar ↑</b> → <b>Adicionar ao ecrã principal</b>.{' '}
        <button className="link" onClick={close}>ok</button>
      </p>
    )
  return null
}
