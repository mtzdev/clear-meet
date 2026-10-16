import { describe, expect, it } from 'vitest'
import {
  buildHistory,
  CHAT_SCHEMA_VERSION,
  parseChat,
  parseChatText,
  serializeChat,
  type ChatMessage
} from './chat'

let counter = 0
const msg = (role: 'user' | 'assistant', text: string): ChatMessage => ({
  id: `m${++counter}`,
  role,
  text,
  createdAt: '2026-10-13T13:00:00.000Z'
})

describe('buildHistory', () => {
  it('mantém a ordem e termina na pergunta atual', () => {
    const history = buildHistory([msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c')])
    expect(history).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' }
    ])
  })

  it('limita às últimas mensagens e nunca começa por uma resposta', () => {
    const messages: ChatMessage[] = []
    for (let i = 1; i <= 10; i++) {
      messages.push(msg('user', `p${i}`), msg('assistant', `r${i}`))
    }
    messages.push(msg('user', 'atual'))
    const history = buildHistory(messages, { maxMessages: 6, maxChars: 10_000 })
    expect(history).toHaveLength(5)
    expect(history[0]).toEqual({ role: 'user', content: 'p9' })
    expect(history.at(-1)).toEqual({ role: 'user', content: 'atual' })
  })

  it('limita pelo tamanho em caracteres, sempre guardando a pergunta atual', () => {
    const big = 'x'.repeat(600)
    const history = buildHistory(
      [
        msg('user', big),
        msg('assistant', big),
        msg('user', big),
        msg('assistant', big),
        msg('user', 'atual')
      ],
      { maxMessages: 12, maxChars: 1000 }
    )
    expect(history.at(-1)).toEqual({ role: 'user', content: 'atual' })
    expect(history.reduce((sum, turn) => sum + turn.content.length, 0)).toBeLessThanOrEqual(1000)
    expect(history[0]?.role).toBe('user')
  })

  it('uma pergunta enorme sozinha continua sendo enviada', () => {
    const history = buildHistory([msg('user', 'y'.repeat(5000))], {
      maxMessages: 12,
      maxChars: 100
    })
    expect(history).toHaveLength(1)
  })

  it('perguntas seguidas (uma ficou sem resposta) viram uma só; mensagens vazias saem', () => {
    const history = buildHistory([
      msg('user', 'primeira'),
      msg('user', 'segunda'),
      msg('assistant', '   '),
      msg('assistant', 'resposta'),
      msg('user', 'terceira')
    ])
    expect(history).toEqual([
      { role: 'user', content: 'primeira\n\nsegunda' },
      { role: 'assistant', content: 'resposta' },
      { role: 'user', content: 'terceira' }
    ])
  })

  it('sem mensagens, histórico vazio', () => {
    expect(buildHistory([])).toEqual([])
  })
})

describe('chat.json', () => {
  it('ida e volta, com provedor, modelo e resposta interrompida', () => {
    const messages: ChatMessage[] = [
      msg('user', 'oi'),
      {
        ...msg('assistant', 'olá'),
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        stopped: true
      }
    ]
    const text = serializeChat({ schemaVersion: CHAT_SCHEMA_VERSION, messages })
    expect(parseChatText(text)).toEqual({
      ok: true,
      value: { schemaVersion: 1, messages }
    })
  })

  it('recusa versão desconhecida, JSON inválido e mensagens malformadas', () => {
    expect(parseChat({ schemaVersion: 2, messages: [] })).toMatchObject({ ok: false })
    expect(parseChat({ schemaVersion: 1, messages: 'x' })).toMatchObject({ ok: false })
    expect(parseChat({ schemaVersion: 1, messages: [{ id: 'a', role: 'system' }] })).toMatchObject({
      ok: false
    })
    expect(parseChatText('{ quebrado')).toMatchObject({ ok: false })
    expect(parseChat(null)).toMatchObject({ ok: false })
  })
})
