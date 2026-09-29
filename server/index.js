import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { ApiError, greenRequest, incomingText, parsePhone, validateCredentials } from './green-api.js'

const sessions = new Map()
const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 3001)
const sessionLifetime = 8 * 60 * 60 * 1000
const allowedOrigins = new Set([...(process.env.NODE_ENV === 'production' ? [] : ['http://127.0.0.1:5173', 'http://localhost:5173']), ...(process.env.FRONTEND_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)])

setInterval(() => {
  for (const [id, session] of sessions) if (session.expires <= Date.now()) sessions.delete(id)
}, 60 * 60 * 1000).unref()

function reply(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  })
  res.end(JSON.stringify(data))
}

function getSession(req) {
  const id = /^Bearer ([a-f0-9]{64})$/i.exec(req.headers.authorization || '')?.[1]
  const session = id && sessions.get(id)
  if (session && session.expires <= Date.now()) {
    sessions.delete(id)
    return { id, session: null }
  }
  return { id, session }
}

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 10000) throw new ApiError('Слишком большой запрос.', 413)
  }
  try { return JSON.parse(raw || '{}') } catch { throw new ApiError('Некорректный JSON.', 400) }
}

async function drain(session) {
  if (session.polling) return
  session.polling = true
  const activeChatId = session.chatId
  try {
    for (let i = 0; i < 25; i++) {
      const notification = await greenRequest(session.credentials, 'receiveNotification', { query: '?receiveTimeout=5' })
      if (!notification) break
      const message = incomingText(notification.body, activeChatId)
      if (message && session.chatId === activeChatId) {
        const key = `${message.chatId}:${message.id}`
        if (!session.seen.has(key)) {
          session.messages.push(message)
          session.seen.add(key)
        }
      }
      if (notification.receiptId == null) throw new ApiError('Уведомление получено без receiptId.')
      const deleted = await greenRequest(session.credentials, 'deleteNotification', { verb: 'DELETE', query: `/${encodeURIComponent(notification.receiptId)}` })
      if (deleted?.result === false) throw new ApiError('Не удалось подтвердить входящее уведомление.')
    }
  } finally { session.polling = false }
}

export const server = http.createServer(async (req, res) => {
  try {
    const origin = req.headers.origin
    if (origin) {
      if (!allowedOrigins.has(origin)) throw new ApiError('Этот сайт не имеет доступа к API.', 403)
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    }
    if (req.method === 'OPTIONS') return reply(res, 204, {})
    const path = new URL(req.url, `http://${host}`).pathname
    const { id, session } = getSession(req)
    if (path === '/api/connect' && req.method === 'POST') {
      const credentials = validateCredentials(await readJson(req))
      const state = await greenRequest(credentials, 'getStateInstance')
      if (state?.stateInstance !== 'authorized') throw new ApiError(`Инстанс не авторизован: ${state?.stateInstance || 'неизвестное состояние'}.`, 401)
      if (id) sessions.delete(id)
      const nextId = randomBytes(32).toString('hex')
      sessions.set(nextId, { credentials, chatId: null, phone: null, messages: [], seen: new Set(), polling: false, expires: Date.now() + sessionLifetime })
      return reply(res, 200, { connected: true, sessionToken: nextId })
    }
    if (path === '/api/disconnect' && req.method === 'POST') {
      if (id) sessions.delete(id)
      return reply(res, 200, { connected: false })
    }
    if (!session) throw new ApiError('Сессия завершена. Подключитесь снова.', 401)
    if (path === '/api/session' && req.method === 'GET') return reply(res, 200, { connected: true, chatId: session.chatId, phone: session.phone, messages: session.messages })
    if (path === '/api/chat' && req.method === 'POST') {
      const phone = parsePhone((await readJson(req)).phone)
      const result = await greenRequest(session.credentials, 'checkAccount', { verb: 'POST', body: { phoneNumber: phone } })
      if (!result?.exist || !result.chatId) throw new ApiError('Аккаунт Telegram не найден или номер скрыт настройками приватности.', 404)
      session.phone = `+${phone}`
      session.chatId = String(result.chatId)
      session.messages = []
      session.seen = new Set()
      return reply(res, 200, { chatId: session.chatId, phone: session.phone, messages: [] })
    }
    if (path === '/api/messages' && req.method === 'GET') {
      if (!session.chatId) throw new ApiError('Сначала откройте чат.', 400)
      await drain(session)
      return reply(res, 200, { messages: session.messages })
    }
    if (path === '/api/messages' && req.method === 'POST') {
      if (!session.chatId) throw new ApiError('Сначала откройте чат.', 400)
      const message = String((await readJson(req)).message ?? '').trim()
      if (!message || message.length > 4096) throw new ApiError('Введите сообщение длиной от 1 до 4096 символов.', 400)
      const result = await greenRequest(session.credentials, 'sendMessage', { verb: 'POST', body: { chatId: session.chatId, message } })
      if (!result?.idMessage) throw new ApiError('GREEN-API не вернул ID сообщения.')
      const item = { id: String(result.idMessage), chatId: session.chatId, text: message, direction: 'outgoing', timestamp: Date.now() }
      const key = `${item.chatId}:${item.id}`
      if (!session.seen.has(key)) { session.messages.push(item); session.seen.add(key) }
      return reply(res, 200, { message: item })
    }
    throw new ApiError('Маршрут не найден.', 404)
  } catch (error) {
    reply(res, error.status || 500, { error: error instanceof ApiError ? error.message : 'Внутренняя ошибка сервера.' })
  }
})

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(port, host, () => console.log(`API: http://${host}:${port}`))
}
