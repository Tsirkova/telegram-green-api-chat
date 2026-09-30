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
    chat: <><path d="M20 11.5a8.5 8.5 0 0 1-8.5 8.5 8.6 8.6 0 0 1-4-.95L3 20l.95-4.5a8.5 8.5 0 1 1 16.05-4Z"/></>,
    user: <><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    eye: <><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z"/><circle cx="12" cy="12" r="2.5"/></>,
    eyeOff: <><path d="m3 3 18 18M10 7.2A11 11 0 0 1 12 7c6 0 9.5 5 9.5 5a14 14 0 0 1-3.2 3.1M6.3 8.3C3.8 9.9 2.5 12 2.5 12s3.5 5 9.5 5c1.4 0 2.7-.3 3.8-.7"/></>,
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
  const [creatingChat, setCreatingChat] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
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
      setChatId(data.chatId); setPhone(data.phone); setMessages(data.messages); setNewPhone(''); setCreatingChat(false); setSidebarOpen(false)
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
    setConnected(false); setChatId(null); setPhone(''); setMessages([]); setError(''); setCreatingChat(false); setSidebarOpen(false)
  }

  if (!ready) return <div className="loading">Загрузка…</div>

  const lastMessage = messages.at(-1)
  const lastPreview = lastMessage ? (lastMessage.direction === 'outgoing' ? 'Вы: ' : '') + lastMessage.text : 'Сообщений пока нет'
  const lastTime = lastMessage ? new Date(lastMessage.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : null
  const startNewChat = () => { setCreatingChat(true); setError(''); setSidebarOpen(false) }

  return <div className={'app-shell' + (!connected ? ' disconnected' : '')}>
    {connected && sidebarOpen && <button className="sidebar-backdrop" aria-label="Закрыть список чатов" onClick={() => setSidebarOpen(false)}/>}
    {connected && <aside className={'sidebar' + (sidebarOpen ? ' open' : '')}>
      <div className="sidebar-header">
        <strong>Чаты</strong>
        {connected && <button className="new-chat" onClick={startNewChat} aria-label="Новый чат" title="Новый чат"><Icon name="plus" size={20}/><span>Новый чат</span></button>}
      </div>
      <div className="chat-list">
        {chatId ? <button className={'chat-list-item' + (!creatingChat ? ' selected' : '')} onClick={() => { setCreatingChat(false); setError(''); setSidebarOpen(false) }}>
          <span className="avatar"><Icon name="user" size={22}/></span>
          <span className="chat-list-copy"><strong>{phone}</strong><small>{lastPreview}</small></span>
          {lastTime && <time>{lastTime}</time>}
        </button> : <p className="empty-list">{connected ? 'Пока нет чатов. Нажмите «Новый чат», чтобы указать получателя.' : 'Подключите аккаунт, чтобы начать переписку.'}</p>}
      </div>
      <div className="sidebar-bottom"><span className={'status-dot' + (connected ? ' online' : '')}/><span>{connected ? 'Аккаунт подключён' : 'Аккаунт не подключён'}</span>{connected && <button onClick={disconnect}>Отключить</button>}</div>
    </aside>}
    <main className="main">
      {connected && <header className="topbar">
        <button className="mobile-menu" type="button" aria-label="Открыть список чатов" onClick={() => setSidebarOpen(true)}><Icon name="menu" size={22}/></button>
        {chatId && !creatingChat ? <div className="topbar-label"><span className="avatar small"><Icon name="user" size={19}/></span><strong>{phone}</strong></div> : <strong>Новый чат</strong>}
      </header>}
      {!connected ? <section className="setup-view">
        <div className="setup-panel">
          <h1>Подключите аккаунт</h1>
          <p className="view-intro">Введите данные Telegram-инстанса из кабинета GREEN-API.</p>
          <form onSubmit={connect}>
            <label>ID инстанса<input required inputMode="numeric" autoComplete="off" value={credentials.idInstance} onChange={e => setCredentials({ ...credentials, idInstance: e.target.value })} placeholder="Например, 4100000000"/></label>
            <label>API-токен
              <span className="token-field"><input required type={showToken ? 'text' : 'password'} autoComplete="off" value={credentials.apiTokenInstance} onChange={e => setCredentials({ ...credentials, apiTokenInstance: e.target.value })} placeholder="Введите токен"/><button type="button" aria-label={showToken ? 'Скрыть токен' : 'Показать токен'} onClick={() => setShowToken(value => !value)}><Icon name={showToken ? 'eyeOff' : 'eye'} size={19}/></button></span>
            </label>
            <details className="advanced-settings"><summary>Дополнительные настройки</summary><label>Адрес API<input required type="url" value={credentials.apiUrl} onChange={e => setCredentials({ ...credentials, apiUrl: e.target.value })} placeholder="https://api.green-api.com"/></label><p>Если в кабинете указан другой адрес API, замените его здесь.</p></details>
            {error && <div className="error" role="alert">{error}</div>}
            <button className="primary" disabled={busy}>{busy ? 'Подключаем…' : 'Подключиться'}</button>
          </form>
          <p className="privacy">ID и токен не записываются на диск. После отключения или через 8 часов их потребуется ввести заново.</p>
        </div>
      </section> : (!chatId || creatingChat) ? <section className="setup-view">
        <div className="setup-panel phone-panel">
          <h1>Новый чат</h1>
          <form onSubmit={openChat}>
            <label>Номер телефона<input required type="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="+7 999 123-45-67" autoFocus/></label>
            <p className="field-hint">Укажите номер получателя в международном формате.</p>
            {error && <div className="error" role="alert">{error}</div>}
            <button className="primary" disabled={busy}>{busy ? 'Ищем аккаунт…' : 'Открыть чат'}</button>
          </form>
        </div>
      </section> : <section className="conversation">
        <div className="messages" aria-live="polite">
          {messages.length === 0 && <div className="conversation-empty">Напишите первое сообщение</div>}
          {messages.map(message => <div key={message.chatId + ':' + message.id} className={'message ' + message.direction}>
            <div>{message.text}</div>
            <small><time>{new Date(message.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>{message.direction === 'outgoing' && <span title="Сообщение принято GREEN-API, доставка адресату не подтверждена">Принято API</span>}</small>
          </div>)}
          <div ref={bottom}/>
        </div>
        <div className="composer-area">
          {error && <div className="error" role="alert">{error}</div>}
          <form className="composer" onSubmit={send}>
            <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Сообщение" maxLength={4096} aria-label="Сообщение"/>
            <button disabled={busy || !draft.trim()} aria-label="Отправить сообщение"><Icon name="send" size={21}/></button>
          </form>
        </div>
      </section>}
    </main>
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
