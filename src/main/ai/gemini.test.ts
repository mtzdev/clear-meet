import { describe, expect, it } from 'vitest'
import { AiError, classifyHttpError } from './errors'
import { GeminiClient, parseGenerateResponse, type GeminiDeps } from './gemini'

const KEY = 'AIzaSyDUMMY-key-never-in-urls'

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

function errorBody(status: number, message: string, extra: object = {}): Response {
  return json({ error: { code: status, message, ...extra } }, status)
}

/** Fetch roteirizado: cada chamada consome a próxima resposta da fila. */
function setup(replies: Reply[], overrides: Partial<GeminiDeps> = {}) {
  const calls: Call[] = []
  const sleeps: number[] = []
  const queue = [...replies]
  const client = new GeminiClient(KEY, {
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

const generated = (text: string, finishReason = 'STOP'): Response =>
  json({ candidates: [{ content: { parts: [{ text }] }, finishReason }] })

describe('GeminiClient.uploadFile', () => {
  it('envia em duas etapas (resumable) e devolve o arquivo', async () => {
    const { client, calls } = setup([
      new Response(null, {
        status: 200,
        headers: { 'x-goog-upload-url': 'https://upload.test/u1' }
      }),
      json({
        file: {
          name: 'files/abc',
          uri: 'https://g.test/files/abc',
          mimeType: 'audio/ogg',
          state: 'ACTIVE'
        }
      })
    ])
    const data = new Uint8Array([1, 2, 3, 4])
    const file = await client.uploadFile({ data, mimeType: 'audio/ogg', displayName: 'bloco' })

    expect(file).toEqual({
      name: 'files/abc',
      uri: 'https://g.test/files/abc',
      mimeType: 'audio/ogg',
      state: 'ACTIVE'
    })
    const [start, finish] = calls
    expect(start?.url).toContain('/upload/v1beta/files')
    const startHeaders = new Headers(start?.init.headers)
    expect(startHeaders.get('x-goog-api-key')).toBe(KEY)
    expect(startHeaders.get('x-goog-upload-command')).toBe('start')
    expect(startHeaders.get('x-goog-upload-protocol')).toBe('resumable')
    expect(startHeaders.get('x-goog-upload-header-content-length')).toBe('4')
    expect(startHeaders.get('x-goog-upload-header-content-type')).toBe('audio/ogg')
    expect(finish?.url).toBe('https://upload.test/u1')
    const finishHeaders = new Headers(finish?.init.headers)
    expect(finishHeaders.get('x-goog-upload-command')).toBe('upload, finalize')
    expect(finishHeaders.get('x-goog-upload-offset')).toBe('0')
    expect(finish?.init.body).toBe(data)
    // A chave nunca vai na URL.
    expect(calls.some((call) => call.url.includes(KEY))).toBe(false)
  })

  it('sem o endereço de envio na resposta, falha com resposta inválida', async () => {
    const { client } = setup([new Response(null, { status: 200 })])
    await expect(
      client.uploadFile({ data: new Uint8Array(1), mimeType: 'audio/ogg', displayName: 'x' })
    ).rejects.toMatchObject({ kind: 'bad-response' })
  })
})

describe('GeminiClient.waitUntilActive', () => {
  const processing = {
    name: 'files/abc',
    uri: 'u',
    mimeType: 'audio/ogg',
    state: 'PROCESSING'
  } as const

  it('consulta até o arquivo ficar ACTIVE', async () => {
    const { client, calls, sleeps } = setup(
      [
        json({ name: 'files/abc', uri: 'u', mimeType: 'audio/ogg', state: 'PROCESSING' }),
        json({ name: 'files/abc', uri: 'u', mimeType: 'audio/ogg', state: 'ACTIVE' })
      ],
      { activePollMs: 7 }
    )
    const file = await client.waitUntilActive(processing)
    expect(file.state).toBe('ACTIVE')
    expect(calls).toHaveLength(2)
    expect(calls[0]?.url).toContain('/v1beta/files/abc')
    expect(sleeps).toEqual([7, 7])
  })

  it('arquivo que falhou no processamento vira erro', async () => {
    const { client } = setup([
      json({ name: 'files/abc', uri: 'u', mimeType: 'audio/ogg', state: 'FAILED' })
    ])
    await expect(client.waitUntilActive(processing)).rejects.toMatchObject({ kind: 'bad-response' })
  })

  it('já ACTIVE não consulta nada', async () => {
    const { client, calls } = setup([])
    await client.waitUntilActive({ ...processing, state: 'ACTIVE' })
    expect(calls).toHaveLength(0)
  })
})

describe('GeminiClient.generate', () => {
  it('pede JSON estruturado e devolve o texto', async () => {
    const { client, calls } = setup([generated('{"utterances":[]}')])
    const schema = { type: 'object' }
    const result = await client.generate({
      model: 'gemini-3.5-flash-lite',
      parts: [{ fileData: { mimeType: 'audio/ogg', fileUri: 'u' } }, { text: 'transcreva' }],
      jsonSchema: schema,
      maxOutputTokens: 1000
    })
    expect(result).toEqual({ text: '{"utterances":[]}', truncated: false })

    const call = calls[0]
    expect(call?.url).toContain('/v1beta/models/gemini-3.5-flash-lite:generateContent')
    const body = JSON.parse(call?.init.body as string) as {
      contents: { parts: unknown[] }[]
      generationConfig: Record<string, unknown>
    }
    expect(body.generationConfig).toEqual({
      responseMimeType: 'application/json',
      responseJsonSchema: schema,
      maxOutputTokens: 1000
    })
    expect(body.contents[0]?.parts).toEqual([
      { fileData: { mimeType: 'audio/ogg', fileUri: 'u' } },
      { text: 'transcreva' }
    ])
  })

  it('texto puro: sem schema não liga o modo JSON; instrução de sistema vai à parte', async () => {
    const { client, calls } = setup([generated('olá')])
    await client.generate({ model: 'm', parts: [{ text: 'oi' }], systemInstruction: 'seja breve' })
    const body = JSON.parse(calls[0]?.init.body as string) as Record<string, unknown>
    expect(body.generationConfig).toEqual({})
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'seja breve' }] })
  })

  it('resposta cortada no limite de tokens é sinalizada', async () => {
    const { client } = setup([generated('{"utt', 'MAX_TOKENS')])
    expect(await client.generate({ model: 'm', parts: [] })).toEqual({
      text: '{"utt',
      truncated: true
    })
  })

  it('bloqueio de segurança vira erro "blocked"', () => {
    expect(() => parseGenerateResponse({ candidates: [{ finishReason: 'SAFETY' }] })).toThrowError(
      expect.objectContaining({ kind: 'blocked' }) as Error
    )
    expect(() => parseGenerateResponse({ promptFeedback: { blockReason: 'OTHER' } })).toThrowError(
      expect.objectContaining({ kind: 'blocked' }) as Error
    )
    expect(() => parseGenerateResponse({})).toThrowError(
      expect.objectContaining({ kind: 'bad-response' }) as Error
    )
  })
})

describe('GeminiClient: erros e novas tentativas', () => {
  it('429 é repetido com espera (respeita o retryDelay do Google) e depois dá certo', async () => {
    const { client, calls, sleeps } = setup([
      errorBody(429, 'Resource has been exhausted', {
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' }]
      }),
      generated('ok')
    ])
    const result = await client.generate({ model: 'm', parts: [] })
    expect(result.text).toBe('ok')
    expect(calls).toHaveLength(2)
    expect(sleeps).toHaveLength(1)
    expect(sleeps[0]).toBeGreaterThanOrEqual(12_000)
  })

  it('sem dica de espera, o intervalo cresce exponencialmente', async () => {
    const { client, sleeps } = setup(
      [errorBody(503, 'x'), errorBody(503, 'x'), errorBody(500, 'x'), generated('ok')],
      { baseDelayMs: 1000 }
    )
    await client.generate({ model: 'm', parts: [] })
    expect(sleeps).toEqual([1000, 2000, 4000])
  })

  it('com a configuração padrão, uma sobrecarga (503) é esperada por cerca de 2 minutos antes de desistir', async () => {
    const messages: string[] = []
    const { client, calls, sleeps } = setup(
      [
        ...Array.from({ length: 6 }, () => errorBody(503, 'The model is overloaded')),
        generated('ok')
      ],
      { log: (message) => messages.push(message) }
    )
    expect((await client.generate({ model: 'm', parts: [] })).text).toBe('ok')
    expect(calls).toHaveLength(7)
    expect(sleeps).toEqual([2000, 4000, 8000, 16_000, 32_000, 60_000])
    expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(122_000)
    expect(messages[0]).toBe(
      '[ia] tentativa 1 de 7 falhou (unavailable, HTTP 503); nova tentativa em 2 s'
    )
    expect(messages).toHaveLength(6)
  })

  it('persistindo além de todas as tentativas, o erro final é "unavailable"', async () => {
    const { client, calls } = setup(Array.from({ length: 7 }, () => errorBody(503, 'overloaded')))
    await expect(client.generate({ model: 'm', parts: [] })).rejects.toMatchObject({
      kind: 'unavailable'
    })
    expect(calls).toHaveLength(7)
  })

  it('Retry-After maior que a espera calculada é respeitado', async () => {
    const { client, sleeps } = setup([
      new Response('{}', { status: 503, headers: { 'retry-after': '90' } }),
      generated('ok')
    ])
    await client.generate({ model: 'm', parts: [] })
    expect(sleeps).toEqual([90_000])
  })

  it('cota diária esgotada não é repetida', async () => {
    const { client, calls } = setup([
      errorBody(429, 'Quota exceeded for metric: generate_content_free_tier_requests, limit PerDay')
    ])
    await expect(client.generate({ model: 'm', parts: [] })).rejects.toMatchObject({
      kind: 'quota',
      retryable: false
    })
    expect(calls).toHaveLength(1)
  })

  it('desiste depois de todas as tentativas', async () => {
    const { client, calls } = setup(
      Array.from({ length: 3 }, () => errorBody(503, 'sobrecarregado')),
      { maxAttempts: 3 }
    )
    await expect(client.generate({ model: 'm', parts: [] })).rejects.toMatchObject({
      kind: 'unavailable'
    })
    expect(calls).toHaveLength(3)
  })

  it('chave inválida falha na hora, sem repetir e sem vazar a chave', async () => {
    const { client, calls } = setup([
      errorBody(400, 'API key not valid. Please pass a valid API key.', {
        status: 'INVALID_ARGUMENT'
      })
    ])
    const error = (await client
      .generate({ model: 'm', parts: [] })
      .catch((e: unknown) => e)) as AiError
    expect(error).toBeInstanceOf(AiError)
    expect(error.kind).toBe('invalid-key')
    expect(error.message).not.toContain(KEY)
    expect(calls).toHaveLength(1)
  })

  it('modelo inexistente (404) e pedido ruim (400) não são repetidos', async () => {
    const missing = setup([errorBody(404, 'models/x is not found')])
    await expect(missing.client.generate({ model: 'x', parts: [] })).rejects.toMatchObject({
      kind: 'model'
    })
    const bad = setup([errorBody(400, 'Invalid JSON payload')])
    await expect(bad.client.generate({ model: 'x', parts: [] })).rejects.toMatchObject({
      kind: 'bad-request'
    })
    expect(missing.calls).toHaveLength(1)
    expect(bad.calls).toHaveLength(1)
  })

  it('falha de rede é repetida e, se persistir, vira erro de rede', async () => {
    const recovered = setup([new TypeError('fetch failed'), generated('ok')])
    expect((await recovered.client.generate({ model: 'm', parts: [] })).text).toBe('ok')

    const down = setup([new TypeError('fetch failed'), new TypeError('fetch failed')], {
      maxAttempts: 2
    })
    await expect(down.client.generate({ model: 'm', parts: [] })).rejects.toMatchObject({
      kind: 'network'
    })
  })

  it('cancelar antes de começar não chama a rede', async () => {
    const { client, calls } = setup([generated('ok')])
    const controller = new AbortController()
    controller.abort()
    await expect(
      client.generate({ model: 'm', parts: [] }, controller.signal)
    ).rejects.toMatchObject({ kind: 'cancelled' })
    expect(calls).toHaveLength(0)
  })

  it('cancelar durante a requisição interrompe e vira "cancelled" (sem repetir)', async () => {
    const controller = new AbortController()
    const { client, calls } = setup([
      () => {
        controller.abort()
        throw new DOMException('aborted', 'AbortError')
      },
      generated('nunca')
    ])
    await expect(
      client.generate({ model: 'm', parts: [] }, controller.signal)
    ).rejects.toMatchObject({ kind: 'cancelled' })
    expect(calls).toHaveLength(1)
  })

  it('cancelar durante a espera do backoff interrompe a espera', async () => {
    const controller = new AbortController()
    const calls: string[] = []
    const client = new GeminiClient(KEY, {
      fetch: ((url: string) => {
        calls.push(url)
        return Promise.resolve(errorBody(503, 'x'))
      }) as unknown as typeof fetch,
      sleep: () => {
        controller.abort()
        return Promise.reject(new AiError('cancelled', 'Cancelado.'))
      }
    })
    await expect(
      client.generate({ model: 'm', parts: [] }, controller.signal)
    ).rejects.toMatchObject({ kind: 'cancelled' })
    expect(calls).toHaveLength(1)
  })
})

describe('GeminiClient: verify e deleteFile', () => {
  it('verify consulta o modelo com a chave no cabeçalho', async () => {
    const { client, calls } = setup([json({ name: 'models/gemini-3.5-flash-lite' })])
    await client.verify('gemini-3.5-flash-lite')
    expect(calls[0]?.url).toContain('/v1beta/models/gemini-3.5-flash-lite')
    expect(calls[0]?.url).not.toContain(KEY)
    expect(new Headers(calls[0]?.init.headers).get('x-goog-api-key')).toBe(KEY)
  })

  it('deleteFile usa DELETE e nunca lança, mesmo sem rede', async () => {
    const ok = setup([json({})])
    await ok.client.deleteFile('files/abc')
    expect(ok.calls[0]?.init.method).toBe('DELETE')
    expect(ok.calls[0]?.url).toContain('/v1beta/files/abc')

    const offline = setup([new TypeError('fetch failed')])
    await expect(offline.client.deleteFile('files/abc')).resolves.toBeUndefined()
  })
})

describe('classifyHttpError', () => {
  it('Retry-After em segundos vira dica de espera', () => {
    const error = classifyHttpError(429, '{}', new Headers({ 'retry-after': '7' }))
    expect(error.options.retryAfterMs).toBe(7000)
    expect(error.retryable).toBe(true)
  })

  it('401 e 403 são chave recusada; 5xx e 408 são transitórios', () => {
    expect(classifyHttpError(401, '').kind).toBe('invalid-key')
    expect(classifyHttpError(403, '').kind).toBe('invalid-key')
    expect(classifyHttpError(500, '').retryable).toBe(true)
    expect(classifyHttpError(408, '').retryable).toBe(true)
    expect(classifyHttpError(418, '').kind).toBe('unknown')
  })
})

describe('classifyHttpError: pedido grande demais', () => {
  it('413 e mensagens de limite de contexto/tokens viram "too-large", sem novas tentativas', () => {
    for (const [status, message] of [
      [413, 'Request Entity Too Large'],
      [
        429,
        'Request too large for model `x` on tokens per minute (TPM): Limit 8000, Requested 18000, please reduce your message size'
      ],
      [400, "This model's maximum context length is 131072 tokens"],
      [400, 'The input token count (200000) exceeds the maximum number of tokens allowed (131072)']
    ] as const) {
      const error = classifyHttpError(status, JSON.stringify({ error: { message } }))
      expect(error.kind).toBe('too-large')
      expect(error.retryable).toBe(false)
    }
  })

  it('um 429 comum por tokens por minuto continua sendo cota, com nova tentativa', () => {
    const error = classifyHttpError(
      429,
      JSON.stringify({
        error: { message: 'Rate limit reached on tokens per minute (TPM): Limit 8000, Used 7000' }
      }),
      new Headers({ 'retry-after': '3' })
    )
    expect(error.kind).toBe('quota')
    expect(error.retryable).toBe(true)
  })
})

describe('GeminiClient.generate com histórico e generateStream', () => {
  it('o histórico vira turnos anteriores e a pergunta atual o último turno', async () => {
    const { client, calls } = setup([generated('ok')])
    await client.generate({
      model: 'gemini-x',
      systemInstruction: 'sistema',
      history: [
        { role: 'user', text: 'p1' },
        { role: 'model', text: 'r1' }
      ],
      parts: [{ text: 'p2' }]
    })
    const body = JSON.parse(calls[0]?.init.body as string) as {
      contents: { role: string; parts: { text: string }[] }[]
    }
    expect(body.contents.map((c) => [c.role, c.parts[0]?.text])).toEqual([
      ['user', 'p1'],
      ['model', 'r1'],
      ['user', 'p2']
    ])
  })

  function sseResponse(...events: unknown[]): Response {
    const body = events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join('')
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  const part = (text: string, finishReason?: string) => ({
    candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }]
  })

  it('entrega o texto aos poucos pelo streamGenerateContent (SSE)', async () => {
    const { client, calls } = setup([
      sseResponse(part('Olá, '), { usageMetadata: {} }, part('mundo', 'STOP'))
    ])
    const received: string[] = []
    const result = await client.generateStream(
      { model: 'gemini-x', parts: [{ text: 'oi' }] },
      (text) => received.push(text)
    )
    expect(received).toEqual(['Olá, ', 'mundo'])
    expect(result).toEqual({ text: 'Olá, mundo', truncated: false })
    expect(calls[0]?.url).toContain(':streamGenerateContent?alt=sse')
    expect(calls[0]?.url).not.toContain(KEY)
  })

  it('marca o corte por tamanho, recusa conteúdo bloqueado e erro dentro do stream', async () => {
    const cut = setup([sseResponse(part('meio', 'MAX_TOKENS'))])
    expect(
      (await cut.client.generateStream({ model: 'm', parts: [{ text: 'x' }] }, () => undefined))
        .truncated
    ).toBe(true)

    const blocked = setup([sseResponse(part('', 'SAFETY'))])
    await expect(
      blocked.client.generateStream({ model: 'm', parts: [{ text: 'x' }] }, () => undefined)
    ).rejects.toMatchObject({ kind: 'blocked' })

    const failing = setup([sseResponse(part('parte'), { error: { code: 503, message: 'x' } })])
    const received: string[] = []
    await expect(
      failing.client.generateStream({ model: 'm', parts: [{ text: 'x' }] }, (t) => received.push(t))
    ).rejects.toMatchObject({ kind: 'unavailable' })
    expect(received).toEqual(['parte'])
  })

  it('503 antes do stream segue as novas tentativas', async () => {
    const { client, calls } = setup([errorBody(503, 'overloaded'), sseResponse(part('ok', 'STOP'))])
    const result = await client.generateStream(
      { model: 'm', parts: [{ text: 'x' }] },
      () => undefined
    )
    expect(result.text).toBe('ok')
    expect(calls).toHaveLength(2)
  })
})
