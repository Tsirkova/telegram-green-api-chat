import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { server } from './index.js'

test('connects, opens a chat, sends and receives text without mixing sessions', async () => {
  const nativeFetch = globalThis.fetch
  const pending = new Map()
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input)
    if (url.hostname !== 'api.green-api.com') return nativeFetch(input, options)
    const instance = /waInstance(\d+)\//.exec(url.pathname)?.[1]
    const method = url.pathname.split('/')[2]
    const response = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (method === 'getStateInstance') return response({ stateInstance: 'authorized' })
    if (method === 'checkAccount') return response({ exist: true, chatId: instance === '4100000001' ? '111' : '222' })
    if (method === 'sendMessage') return response({ idMessage: `sent-${instance}` })
    if (method === 'receiveNotification') return response(pending.get(instance) || null)
    if (method === 'deleteNotification') { pending.delete(instance); return response({ result: true }) }
    throw new Error(`Unexpected method ${method}`)
  }
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const request = async (path, token, body) => {
    const res = await nativeFetch(`${base}/api${path}`, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body) })
    return { status: res.status, data: await res.json() }
  }
  try {
    const first = await request('/connect', null, { apiUrl: 'https://api.green-api.com', idInstance: '4100000001', apiTokenInstance: 'abcdef1234567890' })
    const second = await request('/connect', null, { apiUrl: 'https://api.green-api.com', idInstance: '4100000002', apiTokenInstance: 'abcdef1234567890' })
    assert.equal(first.status, 200)
    assert.notEqual(first.data.sessionToken, second.data.sessionToken)
    const a = first.data.sessionToken
    const b = second.data.sessionToken
    assert.equal((await request('/session', a)).data.connected, true)
    assert.equal((await request('/chat', a, { phone: '+79991234567' })).data.chatId, '111')
    assert.equal((await request('/chat', b, { phone: '+79991234568' })).data.chatId, '222')
    assert.equal((await request('/messages', a, { message: 'Привет' })).data.message.direction, 'outgoing')
    pending.set('4100000001', { receiptId: 1, body: { typeWebhook: 'incomingMessageReceived', idMessage: 'reply-1', timestamp: 1763115112, senderData: { chatId: '111', chatType: 'user' }, messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'Ответ' } } } })
    const result = await request('/messages', a)
    assert.equal(result.data.messages.find(item => item.id === 'reply-1')?.text, 'Ответ')
    assert.equal((await request('/messages', b)).data.messages.length, 0)
    assert.equal((await request('/session', b)).data.phone, '+79991234568')
    assert.equal((await request('/messages', a, { message: '   ' })).status, 400)
    assert.equal((await request('/session', '0'.repeat(64))).status, 401)
  } finally {
    globalThis.fetch = nativeFetch
    server.close()
    await once(server, 'close')
  }
})
