import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { sb } from './lib.js'
import { Login, NewPassword } from './Auth.jsx'
import Panel from './Panel.jsx'
import BookingPage from './BookingPage.jsx'
import ManagePage from './ManagePage.jsx'
import './styles.css'
import './extra.css'

// Links de e-mail (confirmar conta / redefinir palavra-passe) chegam com
// "#access_token=…&type=…". O Supabase lê isso antes de o router mexer no endereço.
const authHash = /access_token=|error_description=|type=recovery/.test(location.hash)
let recovering = /type=recovery/.test(location.hash)

function Home() {
  const [session, setSession] = useState(undefined)
  const [recovery, setRecovery] = useState(recovering)
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = sb.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])
  if (session === undefined) return <div className="page center"><p className="muted">A carregar…</p></div>
  if (session && recovery) return <NewPassword onDone={() => { recovering = false; setRecovery(false) }} />
  return session ? <Panel session={session} /> : <Login />
}

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/painel" replace />} />
        <Route path="/painel" element={<Home />} />
        <Route path="/s/:slug" element={<BookingPage />} />
        <Route path="/m/:token" element={<ManagePage />} />
        <Route path="*" element={<Navigate to="/painel" replace />} />
      </Routes>
    </HashRouter>
  )
}

async function start() {
  if (authHash) {
    const err = new URLSearchParams(location.hash.slice(1)).get('error_description')
    await sb.auth.getSession() // espera o Supabase guardar a sessão do link
    history.replaceState(null, '', location.pathname + location.search + '#/painel')
    if (err) alert(err.replace(/\+/g, ' '))
  }
  createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
}
start()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e)))
}
