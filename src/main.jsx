import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const tokenKey = 'telegram-chat-session'

async function api(path, options) {
  if (import.meta.env.PROD && !apiBase) throw new Error('Адрес API не настроен. Укажите VITE_API_BASE_URL при сборке сайта.')
  let response
  try {
    const token = sessionStorage.getItem(tokenKey)
    response = await fetch(`${apiBase}/api${path}`, { ...options, headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' })
  } catch {
    throw new Error('Не удалось обратиться к API-серверу. Откройте основной адрес сайта telegram-green-api-chat-six.vercel.app и повторите попытку. Если ошибка останется, проверьте доступность API-сервера.')
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) sessionStorage.removeItem(tokenKey)
    const error = new Error(data.error || 'Не удалось выполнить запрос.')
    error.status = response.status
    throw error
  }
  return data
}

function Icon({ name, size = 20 }) {
  const paths = {
    send: <><path d="m3 11 18-8-8 18-2.8-7.2L3 11Z"/><path d="m10.2 13.8 5.3-5.3"/></>,
    back: <><path d="m14 5-7 7 7 7"/></>,
    check: <><path d="m4 12 5 5L20 6"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    chat: <><path d="M20 11.5a8.5 8.5 0 0 1-8.5 8.5 8.6 8.6 0 0 1-4-.95L3 20l.95-4.5a8.5 8.5 0 1 1 16.05-4Z"/></>,
    bolt: <><path d="m13 2-9 11h7l-1 9 10-12h-7V2Z"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function App() {
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(false)
  const [chatId, setChatId] = useState(null)
  const [phone, setPhone] = useState('')
  const [credentials, setCredentials] = useState({ apiUrl: 'https://api.green-api.com', idInstance: '', apiTokenInstance: '' })
  const [newPhone, setNewPhone] = useState('')
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bottom = useRef(null)

  useEffect(() => {
    if (!sessionStorage.getItem(tokenKey)) { setReady(true); return }
    api('/session').then(data => {
      setConnected(true); setChatId(data.chatId); setPhone(data.phone || ''); setMessages(data.messages || [])
    }).catch(() => {}).finally(() => setReady(true))
  }, [])

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length, chatId])

  useEffect(() => {
    if (!chatId) return
    let active = true
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const data = await api('/messages')
        if (active) { setMessages(data.messages); setError('') }
      } catch (err) {
        if (active) {
          if (err.status === 401) { setConnected(false); setChatId(null); setMessages([]) }
          setError(err.message)
        }
      } finally { polling = false }
    }
    poll()
    const timer = setInterval(poll, 5000)
    return () => { active = false; clearInterval(timer) }
  }, [chatId])

  async function connect(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const data = await api('/connect', { method: 'POST', body: JSON.stringify(credentials) })
      sessionStorage.setItem(tokenKey, data.sessionToken)
      setCredentials({ apiUrl: 'https://api.green-api.com', idInstance: '', apiTokenInstance: '' })
      setConnected(true)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function openChat(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const data = await api('/chat', { method: 'POST', body: JSON.stringify({ phone: newPhone }) })
      setChatId(data.chatId); setPhone(data.phone); setMessages(data.messages); setNewPhone('')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function send(event) {
    event.preventDefault()
    if (!draft.trim() || busy) return
    setBusy(true); setError('')
    try {
      const data = await api('/messages', { method: 'POST', body: JSON.stringify({ message: draft }) })
      setMessages(current => current.some(item => item.id === data.message.id && item.chatId === data.message.chatId) ? current : [...current, data.message])
      setDraft('')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function disconnect() {
    await api('/disconnect', { method: 'POST' }).catch(() => {})
    sessionStorage.removeItem(tokenKey)
    setConnected(false); setChatId(null); setPhone(''); setMessages([]); setError('')
  }

  if (!ready) return <div className="loading">Загрузка…</div>

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="send" size={22}/></span><span><strong>Telegram Chat</strong><small>powered by GREEN-API</small></span></div>
      <div className="sidebar-section"><span className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</span><div className="sidebar-title">Сообщения <span className="count">{chatId ? '1' : '0'}</span></div></div>
      {connected && <button className="new-chat" onClick={() => { setChatId(null); setMessages([]); setError('') }}>＋ &nbsp; Новый чат</button>}
      {chatId && <div className="chat-list-item"><div className="avatar">{phone.slice(-2)}</div><div><strong>{phone}</strong><small>Личный чат</small></div><span className="list-arrow">›</span></div>}
      {!chatId && <div className="empty-list"><Icon name="chat" size={25}/><p>Здесь появится<br/>ваш чат</p></div>}
      <div className="sidebar-bottom"><span className="status-dot"/> {connected ? 'Инстанс подключён' : 'Нет подключения'}{connected && <button onClick={disconnect}>Отключить</button>}</div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="topbar-label">{chatId ? <><div className="avatar small">{phone.slice(-2)}</div><span><strong>{phone}</strong><small>Telegram</small></span></> : <><div className="topbar-icon"><Icon name="chat"/></div><span><strong>Сообщения</strong><small>Простой чат для общения</small></span></>}</div><div className="topbar-badge"><span className="status-dot"/> {connected ? 'Подключено' : 'GREEN-API'}</div></header>
      {!connected ? <section className="center-content"><div className="hero-icon"><Icon name="send" size={32}/></div><div className="eyebrow blue">НАЧНИТЕ ОБЩЕНИЕ</div><h1>Ваш Telegram.<br/><span>В одном окне.</span></h1><p className="intro">Подключите инстанс GREEN-API, чтобы отправлять и получать текстовые сообщения прямо здесь.</p><form className="card" onSubmit={connect}><div className="card-header"><Icon name="bolt" size={19}/><strong>Подключение инстанса</strong></div><label>Адрес API<input required type="url" value={credentials.apiUrl} onChange={e => setCredentials({ ...credentials, apiUrl: e.target.value })} placeholder="https://api.green-api.com"/></label><div className="field-row"><label>ID инстанса<input required inputMode="numeric" value={credentials.idInstance} onChange={e => setCredentials({ ...credentials, idInstance: e.target.value })} placeholder="4100000000"/></label><label>API-токен<input required type="password" value={credentials.apiTokenInstance} onChange={e => setCredentials({ ...credentials, apiTokenInstance: e.target.value })} placeholder="Введите токен"/></label></div>{error && <div className="error" role="alert">{error}</div>}<button className="primary" disabled={busy}>{busy ? 'Подключаем…' : 'Подключиться'} <span>→</span></button><div className="privacy"><Icon name="lock" size={14}/> Данные доступны только в текущей сессии</div></form></section>
      : !chatId ? <section className="center-content"><div className="hero-icon"><Icon name="chat" size={32}/></div><div className="eyebrow blue">НОВЫЙ ДИАЛОГ</div><h1>Начните<br/><span>разговор.</span></h1><p className="intro">Введите номер телефона получателя в международном формате. Мы найдём его аккаунт в Telegram.</p><form className="card phone-card" onSubmit={openChat}><div className="card-header"><Icon name="chat" size={19}/><strong>Новый чат</strong></div><label>Номер телефона<input required type="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="+7 999 123-45-67" autoFocus/></label>{error && <div className="error" role="alert">{error}</div>}<button className="primary" disabled={busy}>{busy ? 'Ищем аккаунт…' : 'Открыть чат'} <span>→</span></button></form></section>
      : <section className="conversation"><div className="messages"><div className="date-chip">Сегодня</div>{messages.length === 0 && <div className="conversation-empty">Чат открыт. Напишите первое сообщение.</div>}{messages.map(message => <div key={`${message.chatId}:${message.id}`} className={`message ${message.direction}`}><div>{message.text}</div><small>{new Date(message.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}{message.direction === 'outgoing' && <Icon name="check" size={14}/>}</small></div>)}<div ref={bottom}/></div><div className="composer-area">{error && <div className="error" role="alert">{error}</div>}<form className="composer" onSubmit={send}><input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Напишите сообщение…" maxLength={4096} aria-label="Сообщение"/><button disabled={busy || !draft.trim()} aria-label="Отправить"><Icon name="send" size={19}/></button></form><div className="composer-note">Только текстовые сообщения · Telegram через GREEN-API</div></div></section>}
    </main>
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
