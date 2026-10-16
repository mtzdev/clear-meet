import { describe, expect, it } from 'vitest'
import { AiError } from './errors'
import {
  buildBody,
  OpenAiCompatClient,
  parseCompletion,
  type OpenAiChatRequest,
  type OpenAiDeps
} from './openai-compat'

const KEY = 'gsk_DUMMY-key-never-in-errors'

interface Call {
  url: string
  init: RequestInit
}

type Reply = Response | Error | ((call: Call) => Response)

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function errorBody(status: number, message: string, headers: Record<string, string> = {}) {
  return json({ error: { message, type: 'error', code: 'x' } }, status, headers)
}

/** Resposta SSE entregue em pedaços (o corte pode cair no meio de um evento). */
function sse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const delta = (content: string, finish: string | null = null): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`

function setup(replies: Reply[], overrides: Partial<OpenAiDeps> = {}) {
  const calls: Call[] = []
  const sleeps: number[] = []
  const queue = [...replies]
  const client = new OpenAiCompatClient(KEY, {
    fetch: ((url: string | URL, init: RequestInit) => {
      const call = { url: String(url), init }
      calls.push(call)
      const next = queue.shift()
      if (next === undefined) return Promise.reject(new Error('resposta não roteirizada'))
      if (next instanceof Error) return Promise.reject(next)
      return Promise.resolve(typeof next === 'function' ? next(call) : next)
    }) as typeof fetch,
    sleep: (ms) => {
      sleeps.push(ms)
      return Promise.resolve()
    },
    random: () => 0.5,
    ...overrides
  })
  return { client, calls, sleeps }
}

const request: OpenAiChatRequest = {
  model: 'openai/gpt-oss-120b',
  system: 'Seja breve.',
  messages: [{ role: 'user', content: 'Oi' }]
}

const completion = (content: string, finish = 'stop'): Response =>
  json({ choices: [{ message: { role: 'assistant', content }, finish_reason: finish }] })

async function caught(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AiError)
    return error as AiError
  }
  throw new Error('deveria ter falhado')
}

describe('OpenAiCompatClient.chat', () => {
  it('envia o pedido para /chat/completions com a chave só no cabeçalho', async () => {
    const { client, calls } = setup([completion('Olá!')])
    const result = await client.chat({ ...request, maxOutputTokens: 100 })

    expect(result).toEqual({ text: 'Olá!', truncated: false })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(calls[0]?.url).not.toContain(KEY)
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(calls[0]?.init.body as string) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'openai/gpt-oss-120b',
      stream: false,
      max_completion_tokens: 100,
      messages: [
        { role: 'system', content: 'Seja breve.' },
        { role: 'user', content: 'Oi' }
      ]
    })
  })

  it('usa a base configurada (qualquer API compatível)', async () => {
    const { client, calls } = setup([completion('ok')], { baseUrl: 'http://localhost:1234/v1' })
    await client.chat(request)
    expect(calls[0]?.url).toBe('http://localhost:1234/v1/chat/completions')
  })

  it('marca a resposta cortada pelo limite de tokens', async () => {
    const { client } = setup([completion('meio', 'length')])
    expect(await client.chat(request)).toEqual({ text: 'meio', truncated: true })
  })

  it('413 vira "grande demais" sem novas tentativas', async () => {
    const { client, calls, sleeps } = setup([
      errorBody(
        413,
        'Request too large for model on tokens per minute (TPM): Limit 8000, Requested 18000'
      )
    ])
    const error = await caught(client.chat(request))
    expect(error.kind).toBe('too-large')
    expect(error.retryable).toBe(false)
    expect(calls).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  it('429 espera o retry-after e tenta de novo', async () => {
    const { client, calls, sleeps } = setup([
      errorBody(429, 'Rate limit reached on tokens per minute (TPM)', { 'retry-after': '7' }),
      completion('depois da espera')
    ])
    expect((await client.chat(request)).text).toBe('depois da espera')
    expect(calls).toHaveLength(2)
    expect(sleeps).toEqual([7000])
  })

  it('429 persistente falha depois das tentativas, como cota', async () => {
    const limited = (): Response => errorBody(429, 'Rate limit reached', { 'retry-after': '2' })
    const { client, calls } = setup([limited(), limited(), limited(), limited()])
    const error = await caught(client.chat(request))
    expect(error.kind).toBe('quota')
    expect(calls).toHaveLength(3)
  })

  it('429 com espera longa demais falha na hora, sem dormir', async () => {
    const { client, calls, sleeps } = setup([
      errorBody(429, 'Rate limit reached', { 'retry-after': '600' })
    ])
    const error = await caught(client.chat(request))
    expect(error.kind).toBe('quota')
    expect(calls).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  it('429 de cota diária não tenta de novo', async () => {
    const { client, calls } = setup([errorBody(429, 'Rate limit reached on tokens per day (TPD)')])
    const error = await caught(client.chat(request))
    expect(error.kind).toBe('quota')
    expect(error.retryable).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('tenta de novo em 503 e em falha de rede', async () => {
    const { client, calls } = setup([
      errorBody(503, 'overloaded'),
      new TypeError('fetch failed'),
      completion('ok')
    ])
    expect((await client.chat(request)).text).toBe('ok')
    expect(calls).toHaveLength(3)
  })

  it('chave recusada: 401 sem novas tentativas e sem a chave na mensagem', async () => {
    const { client, calls } = setup([errorBody(401, `Invalid API Key ${KEY}`)])
    const error = await caught(client.chat(request))
    expect(error.kind).toBe('invalid-key')
    expect(error.message).not.toContain(KEY)
    expect(calls).toHaveLength(1)
  })

  it('cancelar durante a espera interrompe com "cancelled"', async () => {
    const controller = new AbortController()
    const { client } = setup([errorBody(503, 'overloaded')], {
      sleep: () => {
        controller.abort()
        return Promise.reject(new AiError('cancelled', 'Cancelado.'))
      }
    })
    const error = await caught(client.chat(request, controller.signal))
    expect(error.kind).toBe('cancelled')
  })

  it('um sinal já cancelado nem chama a rede', async () => {
    const controller = new AbortController()
    controller.abort()
    const { client, calls } = setup([completion('x')])
    expect((await caught(client.chat(request, controller.signal))).kind).toBe('cancelled')
    expect(calls).toHaveLength(0)
  })

  it('resposta sem corpo válido vira "bad-response"', async () => {
    const { client } = setup([new Response('não é json', { status: 200 })])
    expect((await caught(client.chat(request))).kind).toBe('bad-response')
  })
})

describe('buildBody', () => {
  it('JSON Schema vai em response_format, com strict', () => {
    const body = buildBody(
      { ...request, json: { name: 'resumo', schema: { type: 'object' }, strict: true } },
      false
    )
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'resumo', strict: true, schema: { type: 'object' } }
    })
  })

  it('modo "JSON válido" usa json_object; esforço de raciocínio só quando pedido', () => {
    const body = buildBody({ ...request, json: 'object', reasoningEffort: 'low' }, false)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.reasoning_effort).toBe('low')
    expect(buildBody(request, true)).not.toHaveProperty('reasoning_effort')
    expect(buildBody(request, true)).toMatchObject({ stream: true })
  })
})

describe('parseCompletion', () => {
  it('recusa do modelo e filtro de conteúdo viram "blocked"', () => {
    expect(() =>
      parseCompletion({ choices: [{ message: { refusal: 'não posso' }, finish_reason: 'stop' }] })
    ).toThrow(AiError)
    expect(() =>
      parseCompletion({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] })
    ).toThrow(AiError)
    expect(() => parseCompletion({})).toThrow(AiError)
  })
})

describe('OpenAiCompatClient.chatStream', () => {
  it('junta os pedaços de SSE, mesmo cortados no meio de um evento', async () => {
    const first = delta('Olá, ')
    const second = delta('mundo', 'stop')
    const { client, calls } = setup([
      sse([
        first.slice(0, 20),
        first.slice(20) + second.slice(0, 7),
        second.slice(7),
        'data: [DONE]\n\n'
      ])
    ])
    const received: string[] = []
    const result = await client.chatStream(request, (text) => received.push(text))

    expect(result).toEqual({ text: 'Olá, mundo', truncated: false })
    expect(received).toEqual(['Olá, ', 'mundo'])
    expect(JSON.parse(calls[0]?.init.body as string)).toMatchObject({ stream: true })
  })

  it('ignora comentários, eventos sem texto e raciocínio, e marca o corte por tamanho', async () => {
    const reasoning = `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'pensando' } }] })}\n\n`
    const { client } = setup([sse([': keep-alive\n\n', reasoning, delta('texto', 'length')])])
    const received: string[] = []
    const result = await client.chatStream(request, (text) => received.push(text))
    expect(received).toEqual(['texto'])
    expect(result.truncated).toBe(true)
  })

  it('413 antes do stream: erro "grande demais", nada entregue', async () => {
    const { client } = setup([errorBody(413, 'Request too large')])
    const received: string[] = []
    const error = await caught(client.chatStream(request, (text) => received.push(text)))
    expect(error.kind).toBe('too-large')
    expect(received).toEqual([])
  })

  it('erro no meio do stream interrompe com o que já chegou entregue', async () => {
    const { client } = setup([
      sse([delta('parte'), `data: ${JSON.stringify({ error: { message: 'boom' } })}\n\n`])
    ])
    const received: string[] = []
    const error = await caught(client.chatStream(request, (text) => received.push(text)))
    expect(received).toEqual(['parte'])
    expect(error.kind).toBe('unavailable')
  })

  it('cancelar no meio do stream devolve "cancelled"', async () => {
    const controller = new AbortController()
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encoder.encode(delta('inicio')))
      },
      pull() {
        // O fetch real corta o corpo ao abortar; aqui a leitura passa a falhar.
        return new Promise((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('abortado')), {
            once: true
          })
        })
      }
    })
    const { client } = setup([new Response(stream, { status: 200 })])
    const received: string[] = []
    const pending = client.chatStream(
      request,
      (text) => {
        received.push(text)
        controller.abort()
      },
      controller.signal
    )
    const error = await caught(pending)
    expect(error.kind).toBe('cancelled')
    expect(received).toEqual(['inicio'])
  })
})
