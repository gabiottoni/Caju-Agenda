import { useState } from 'react'
import { sb, errMsg, slugify } from './lib.js'

export function Login() {
  const [mode, setMode] = useState('in')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // sem '#/…': o Supabase acrescenta os dados de acesso depois do '#'
  const back = () => location.href.split('#')[0]

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(''); setNotice('')
    const { data, error } =
      mode === 'in'
        ? await sb.auth.signInWithPassword({ email, password: pass })
        : await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: back() } })
    setBusy(false)
    if (error) return setError(errMsg(error))
    if (mode === 'up' && !data.session) setNotice('Conta criada! Abra o e-mail de confirmação para entrar.')
  }

  async function forgot() {
    if (!email) return setError('Escreva o seu e-mail primeiro.')
    await sb.auth.resetPasswordForEmail(email, { redirectTo: back() })
    setNotice('Enviámos um link para redefinir a palavra-passe.')
  }

  return (
    <div className="page login">
      <header className="brand-head">
        <p className="eyebrow">Agenda</p>
        <h1>Marcações sem complicação</h1>
        <p className="muted">As suas clientes marcam pelo link, a profissional aprova e recebe tudo no calendário.</p>
      </header>
      <form className="card stack" onSubmit={submit}>
        <div className="seg" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'in'} className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Entrar</button>
          <button type="button" role="tab" aria-selected={mode === 'up'} className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>Criar conta</button>
        </div>
        {error && <p className="alert" role="alert">{error}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        <label>E-mail<input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>
          Palavra-passe
          <input type="password" required minLength={6} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={pass} onChange={(e) => setPass(e.target.value)} />
        </label>
        <button className="btn primary big" disabled={busy}>{busy ? 'Aguarde…' : mode === 'in' ? 'Entrar' : 'Criar conta'}</button>
        {mode === 'up' && <p className="muted small legal-note">Ao criar conta aceita os <a href="termos.html" target="_blank" rel="noreferrer">Termos de Uso</a> e a <a href="privacidade.html" target="_blank" rel="noreferrer">Política de Privacidade</a>.</p>}
        {mode === 'in' && <button type="button" className="link" onClick={forgot}>Esqueci a palavra-passe</button>}
      </form>
    </div>
  )
}

export function Onboarding({ email, onDone }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const { data: existing } = await sb.from('salons').select('id').limit(1)
    if (existing?.length) { setBusy(false); return onDone() }
    const { data, error } = await sb.from('salons').insert({ name, slug, notify_email: email }).select('id').single()
    if (error) { setBusy(false); return setError(errMsg(error)) }
    await sb.from('working_hours').insert([2, 3, 4, 5, 6].map((d) => ({ salon_id: data.id, weekday: d, start_time: '09:00', end_time: '19:00' })))
    setBusy(false)
    onDone()
  }

  return (
    <div className="page">
      <header className="brand-head">
        <p className="eyebrow">Bem-vinda!</p>
        <h1>Vamos criar o seu espaço</h1>
      </header>
      <form className="card stack" onSubmit={submit}>
        {error && <p className="alert">{error}</p>}
        <label>
          Nome do salão / marca
          <input required minLength={2} maxLength={80} value={name} onChange={(e) => { setName(e.target.value); if (!touched) setSlug(slugify(e.target.value)) }} />
        </label>
        <label>
          Endereço do seu link
          <div className="prefix-input">
            <span>…/#/s/</span>
            <input required pattern="[a-z0-9\-]{3,40}" value={slug} onChange={(e) => { setTouched(true); setSlug(slugify(e.target.value)) }} />
          </div>
          <span className="muted small">Só letras minúsculas, números e hífen.</span>
        </label>
        <button className="btn primary big" disabled={busy}>{busy ? 'A criar…' : 'Criar'}</button>
      </form>
    </div>
  )
}

// Aparece depois de abrir o link "Reset password" do e-mail
export function NewPassword({ onDone }) {
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (pass !== pass2) return setError('As palavras-passe não coincidem.')
    setBusy(true); setError('')
    const { error } = await sb.auth.updateUser({ password: pass })
    setBusy(false)
    if (error) return setError(errMsg(error))
    onDone()
  }

  return (
    <div className="page login">
      <header className="brand-head">
        <p className="eyebrow">Agenda</p>
        <h1>Nova palavra-passe</h1>
      </header>
      <form className="card stack" onSubmit={submit}>
        {error && <p className="alert" role="alert">{error}</p>}
        <label>Nova palavra-passe<input type="password" required minLength={6} autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
        <label>Repetir<input type="password" required minLength={6} autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} /></label>
        <button className="btn primary big" disabled={busy}>{busy ? 'A guardar…' : 'Guardar e entrar'}</button>
      </form>
    </div>
  )
}
