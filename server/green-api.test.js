import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, greenRequest, incomingText, parsePhone, validateCredentials } from './green-api.js'

const credentials = { apiUrl: 'https://4100.api.green-api.com', idInstance: '4100000000', apiTokenInstance: 'abcdef1234567890' }

test('validates credentials and blocks unrelated API hosts', () => {
  assert.equal(validateCredentials(credentials).apiUrl, credentials.apiUrl)
  assert.equal(validateCredentials({ ...credentials, idInstance: '410000000000' }).idInstance, '410000000000')
  assert.throws(() => validateCredentials({ ...credentials, apiUrl: 'https://evil.example' }), ApiError)
  assert.throws(() => validateCredentials({ ...credentials, apiTokenInstance: '' }), ApiError)
})

test('normalizes international phone numbers and rejects invalid input', () => {
  assert.equal(parsePhone('+7 (999) 123-45-67'), 79991234567)
  assert.throws(() => parsePhone('123'), ApiError)
})

test('accepts only incoming text from the selected personal chat', () => {
  const body = { typeWebhook: 'incomingMessageReceived', timestamp: 1763115112, idMessage: 'abc', senderData: { chatId: '100', chatType: 'user' }, messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'Ответ' } } }
  assert.equal(incomingText(body, '100').text, 'Ответ')
  assert.equal(incomingText(body, '200'), null)
  assert.equal(incomingText({ ...body, messageData: { typeMessage: 'imageMessage' } }, '100'), null)
})

test('maps authorization failure and offline failure to readable errors', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ reason: 'invalid token' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
    await assert.rejects(greenRequest(credentials, 'getStateInstance'), /Доступ отклонён/)
    globalThis.fetch = async () => { throw new Error('offline') }
    await assert.rejects(greenRequest(credentials, 'getStateInstance'), /недоступен/)
  } finally { globalThis.fetch = originalFetch }
})
