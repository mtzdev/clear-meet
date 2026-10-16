import { describe, expect, it } from 'vitest'
import type { GeminiClient, GenerateRequest } from '../gemini'
import type { OpenAiChatRequest, OpenAiCompatClient } from '../openai-compat'
import { geminiBackend, groqBackend } from './backends'
import type { TextRequest } from './types'

const signal = new AbortController().signal
const SCHEMA = { type: 'object' }

const base: TextRequest = {
  system: 'sistema',
  messages: [
    { role: 'user', content: 'p1' },
    { role: 'assistant', content: 'r1' },
    { role: 'user', content: 'p2' }
  ],
  maxOutputTokens: 500
}

function fakeGroq() {
  const sent: { request: OpenAiChatRequest; streamed: boolean }[] = []
  const client = {
    chat: (request: OpenAiChatRequest) => {
      sent.push({ request, streamed: false })
      return Promise.resolve({ text: 'ok', truncated: false })
    },
    chatStream: (request: OpenAiChatRequest, onDelta: (t: string) => void) => {
      sent.push({ request, streamed: true })
      onDelta('ok')
      return Promise.resolve({ text: 'ok', truncated: false })
    }
  } as unknown as OpenAiCompatClient
  return { client, sent }
}

describe('groqBackend', () => {
  it('modelo com esquema: JSON Schema estrito e raciocínio leve', async () => {
    const { client, sent } = fakeGroq()
    await groqBackend(client).run(
      'openai/gpt-oss-120b',
      { ...base, json: { name: 'resumo', schema: SCHEMA } },
      signal
    )
    expect(sent[0]?.streamed).toBe(false)
    expect(sent[0]?.request.json).toEqual({ name: 'resumo', schema: SCHEMA, strict: true })
    expect(sent[0]?.request.reasoningEffort).toBe('low')
    expect(sent[0]?.request.maxOutputTokens).toBe(500)
  })

  it('modelo sem esquema: json_object com o schema descrito no prompt', async () => {
    const { client, sent } = fakeGroq()
    await groqBackend(client).run(
      'llama-3.3-70b-versatile',
      { ...base, json: { name: 'resumo', schema: SCHEMA } },
      signal
    )
    expect(sent[0]?.request.json).toBe('object')
    expect(sent[0]?.request.system).toContain('sistema')
    expect(sent[0]?.request.system).toContain('JSON Schema')
    expect(sent[0]?.request.system).toContain(JSON.stringify(SCHEMA))
    expect(sent[0]?.request.reasoningEffort).toBeUndefined()
  })

  it('com onDelta usa streaming e envia o histórico', async () => {
    const { client, sent } = fakeGroq()
    const received: string[] = []
    await groqBackend(client).run('openai/gpt-oss-20b', base, signal, (t) => received.push(t))
    expect(sent[0]?.streamed).toBe(true)
    expect(sent[0]?.request.messages).toHaveLength(3)
    expect(sent[0]?.request.json).toBeUndefined()
    expect(received).toEqual(['ok'])
  })
})

describe('geminiBackend', () => {
  function fakeGemini() {
    const sent: { request: GenerateRequest; streamed: boolean }[] = []
    const client = {
      generate: (request: GenerateRequest) => {
        sent.push({ request, streamed: false })
        return Promise.resolve({ text: 'ok', truncated: false })
      },
      generateStream: (request: GenerateRequest, onDelta: (t: string) => void) => {
        sent.push({ request, streamed: true })
        onDelta('ok')
        return Promise.resolve({ text: 'ok', truncated: false })
      }
    } as unknown as GeminiClient
    return { client, sent }
  }

  it('a última mensagem vira o turno atual e as anteriores o histórico (assistant -> model)', async () => {
    const { client, sent } = fakeGemini()
    await geminiBackend(client).run(
      'gemini-x',
      { ...base, json: { name: 'r', schema: SCHEMA } },
      signal
    )
    expect(sent[0]?.request).toMatchObject({
      model: 'gemini-x',
      systemInstruction: 'sistema',
      history: [
        { role: 'user', text: 'p1' },
        { role: 'model', text: 'r1' }
      ],
      parts: [{ text: 'p2' }],
      jsonSchema: SCHEMA,
      maxOutputTokens: 500
    })
  })

  it('com onDelta usa streamGenerateContent', async () => {
    const { client, sent } = fakeGemini()
    const received: string[] = []
    await geminiBackend(client).run('gemini-x', base, signal, (t) => received.push(t))
    expect(sent[0]?.streamed).toBe(true)
    expect(received).toEqual(['ok'])
  })
})
