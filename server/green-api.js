export class ApiError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.status = status
  }
}

export function normalizeApiUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new ApiError('Укажите корректный адрес API.', 400) }
  if (url.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)*green-api\.com$/i.test(url.hostname) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new ApiError('Используйте HTTPS-адрес хоста GREEN-API без пути и параметров.', 400)
  }
  return url.origin
}

export function validateCredentials(input) {
  if (!input || !/^\d{10}$/.test(String(input.idInstance ?? '')) || !/^[A-Za-z0-9_-]{10,}$/.test(String(input.apiTokenInstance ?? ''))) {
    throw new ApiError('Проверьте ID инстанса и API-токен.', 400)
  }
  return {
    apiUrl: normalizeApiUrl(input.apiUrl),
    idInstance: String(input.idInstance),
    apiTokenInstance: String(input.apiTokenInstance),
  }
}

export function parsePhone(value) {
  const compact = String(value ?? '').replace(/[\s()-]/g, '')
  if (!/^\+?[1-9]\d{7,14}$/.test(compact)) throw new ApiError('Введите номер в международном формате, например +79991234567.', 400)
  return Number(compact.replace('+', ''))
}

export function incomingText(body, chatId) {
  if (body?.typeWebhook !== 'incomingMessageReceived' || body?.senderData?.chatType !== 'user' || String(body.senderData.chatId) !== String(chatId) || body?.messageData?.typeMessage !== 'textMessage') return null
  const text = body?.messageData?.textMessageData?.textMessage
  if (typeof text !== 'string' || !text.trim() || !body.idMessage) return null
  return { id: String(body.idMessage), chatId: String(chatId), text, direction: 'incoming', timestamp: Number(body.timestamp) * 1000 || Date.now() }
}

export async function greenRequest(credentials, method, { verb = 'GET', body, query = '' } = {}) {
  const url = `${credentials.apiUrl}/waInstance${credentials.idInstance}/${method}/${credentials.apiTokenInstance}${query}`
  let response
  try {
    response = await fetch(url, {
      method: verb,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000),
    })
  } catch {
    throw new ApiError('GREEN-API недоступен. Проверьте интернет и адрес API.')
  }
  const data = await response.json().catch(() => null)
  if (!response.ok || data?.status === false) {
    const status = response.status === 401 || response.status === 403 ? 401 : 502
    throw new ApiError(status === 401 ? 'Доступ отклонён. Проверьте ID инстанса и API-токен.' : `Ошибка GREEN-API${data?.reason ? `: ${String(data.reason).slice(0, 180)}` : '.'}`, status)
  }
  return data
}
