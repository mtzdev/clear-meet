import { describe, expect, it } from 'vitest'
import { AiError } from './errors'
import {
  GeminiClient,
  NO_DIARIZATION_MESSAGE,
  parseOffsetMs,
  parseTranscribeResponse,
  type GeminiDeps
} from './gemini'

const KEY = 'AIzaSyDUMMY-key-never-in-urls'

interface Call {
  url: string
  init: RequestInit
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function setup(replies: Response[], overrides: Partial<GeminiDeps> = {}) {
  const calls: Call[] = []
  const queue = [...replies]
  const client = new GeminiClient(KEY, {
    fetch: ((url: string | URL, init: RequestInit) => {
      calls.push({ url: String(url), init })
      const next = queue.shift()
      return next ? Promise.resolve(next) : Promise.reject(new Error('resposta não roteirizada'))
    }) as typeof fetch,
    sleep: () => Promise.resolve(),
    random: () => 0.5,
    ...overrides
  })
  return { client, calls }
}

const info = (text: string, speaker: string | undefined, start: unknown, end?: unknown) => ({
  type: 'word_info',
  text,
  speaker,
  start_offset: start,
  end_offset: end
})

describe('GeminiClient.transcribe', () => {
  it('chama a Interactions API com diarização e tempo por palavra, e a chave só no cabeçalho', async () => {
    const { client, calls } = setup([
      json({
        id: 'interactions/1',
        status: 'completed',
        steps: [
          {
            type: 'model_output',
            content: [
              {
                type: 'text',
                text: 'Oi tudo bem',
                annotations: [info('Oi', 'spk_1', '0.100s', '0.450s')]
              }
            ]
          }
        ]
      })
    ])
    const result = await client.transcribe({
      model: 'gemini-3.5-transcribe',
      fileUri: 'https://g.test/files/abc',
      mimeType: 'audio/ogg'
    })

    expect(result.words).toEqual([{ text: 'Oi', speaker: 'spk_1', startMs: 100, endMs: 450 }])
    expect(calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
    expect(new Headers(calls[0]?.init.headers).get('x-goog-api-key')).toBe(KEY)
    expect(calls.some((call) => call.url.includes(KEY))).toBe(false)
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      model: 'gemini-3.5-transcribe',
      input: [{ type: 'audio', uri: 'https://g.test/files/abc', mime_type: 'audio/ogg' }],
      generation_config: {
        transcription_config: {
          mode: {
            type: 'verbatim',
            diarization_mode: 'speaker',
            timestamp_granularities: ['word']
          }
        }
      }
    })
  })

  it('sobrecarga (503) segue as novas tentativas das outras chamadas', async () => {
    const { client, calls } = setup([
      json({ error: { code: 503, message: 'overloaded' } }, 503),
      json({ steps: [{ content: [{ type: 'text', text: '' }] }] })
    ])
    const result = await client.transcribe({ model: 'm', fileUri: 'u', mimeType: 'audio/ogg' })
    expect(result.words).toEqual([])
    expect(calls).toHaveLength(2)
  })

  it('resposta só com texto falha com o erro da separação de vozes', async () => {
    const { client } = setup([json({ steps: [{ content: [{ type: 'text', text: 'Olá.' }] }] })])
    await expect(
      client.transcribe({ model: 'm', fileUri: 'u', mimeType: 'audio/ogg' })
    ).rejects.toMatchObject({ kind: 'bad-response', message: NO_DIARIZATION_MESSAGE })
  })
})

describe('log da estrutura quando falta word_info', () => {
  it('registra caminhos, tipos e tamanhos, sem o texto nem a chave', async () => {
    const secret = 'Frase confidencial da reunião sobre o orçamento'
    const logs: string[] = []
    const { client } = setup(
      [
        json({
          id: 'interactions/abc',
          status: 'completed',
          steps: [{ type: 'model_output', content: [{ type: 'text', text: secret }] }]
        })
      ],
      { log: (message) => logs.push(message) }
    )
    await expect(
      client.transcribe({ model: 'm', fileUri: 'u', mimeType: 'audio/ogg' })
    ).rejects.toMatchObject({ message: NO_DIARIZATION_MESSAGE })

    expect(logs).toHaveLength(1)
    const log = logs[0] as string
    expect(log).toContain('[ia]')
    expect(log).toContain(
      "steps[0].content[0]: {type:'text', text:string(%d)}".replace('%d', String(secret.length))
    )
    expect(log).toContain("$: {id:string(16), status:'completed', steps:array(1)}")
    expect(log).not.toContain(secret)
    expect(log).not.toContain('orçamento')
    expect(log).not.toContain('interactions/abc')
    expect(log).not.toContain(KEY)
  })

  it('não registra nada quando a resposta traz as palavras', async () => {
    const logs: string[] = []
    const { client } = setup(
      [
        json({
          steps: [
            { content: [{ type: 'text', text: 'a', annotations: [info('a', 'spk_1', '1s')] }] }
          ]
        })
      ],
      { log: (message) => logs.push(message) }
    )
    await client.transcribe({ model: 'm', fileUri: 'u', mimeType: 'audio/ogg' })
    expect(logs).toEqual([])
  })
})

describe('parseOffsetMs', () => {
  it('lê segundos como "1.5s", "12s", "0.100s" ou número; recusa o resto', () => {
    expect(parseOffsetMs('1.5s')).toBe(1500)
    expect(parseOffsetMs('12s')).toBe(12_000)
    expect(parseOffsetMs('0.100s')).toBe(100)
    expect(parseOffsetMs('2.25')).toBe(2250)
    expect(parseOffsetMs(3)).toBe(3000)
    expect(parseOffsetMs('-1s')).toBeNull()
    expect(parseOffsetMs('abc')).toBeNull()
    expect(parseOffsetMs(undefined)).toBeNull()
  })
})

describe('parseTranscribeResponse', () => {
  it('acha word_info em qualquer nível, na ordem em que aparecem', () => {
    const result = parseTranscribeResponse({
      steps: [
        {
          content: [
            { type: 'text', text: 'a b', annotations: [info('a', 'spk_1', '1.5s', '1.8s')] }
          ]
        },
        { content: [{ type: 'text', text: 'c' }], annotations: [info('b', 'spk_2', '2s', '2.5s')] }
      ]
    })
    expect(result.words).toEqual([
      { text: 'a', speaker: 'spk_1', startMs: 1500, endMs: 1800 },
      { text: 'b', speaker: 'spk_2', startMs: 2000, endMs: 2500 }
    ])
  })

  it('descarta palavras sem texto ou sem início legível; sem fim, usa o início', () => {
    const result = parseTranscribeResponse({
      steps: [
        {
          content: [
            {
              type: 'text',
              text: 'x',
              annotations: [
                info('ok', 'spk_1', '1s'),
                info('', 'spk_1', '2s', '3s'),
                info('sem início', 'spk_1', 'xx', '3s')
              ]
            }
          ]
        }
      ]
    })
    expect(result.words).toEqual([{ text: 'ok', speaker: 'spk_1', startMs: 1000, endMs: 1000 }])
  })

  it('texto sem word_info é erro claro, em vez de uma voz só', () => {
    const body = { steps: [{ content: [{ type: 'text', text: 'Olá, tudo bem?' }] }] }
    expect(() => parseTranscribeResponse(body)).toThrow(NO_DIARIZATION_MESSAGE)
    expect(() => parseTranscribeResponse(body)).toThrow(AiError)
  })

  it('palavras sem nenhum Falante também são erro', () => {
    const body = {
      steps: [{ content: [{ type: 'text', text: 'a', annotations: [info('a', undefined, '1s')] }] }]
    }
    expect(() => parseTranscribeResponse(body)).toThrow(NO_DIARIZATION_MESSAGE)
  })

  it('áudio sem fala (texto vazio e sem palavras) devolve lista vazia', () => {
    expect(parseTranscribeResponse({ steps: [{ content: [{ type: 'text', text: '' }] }] })).toEqual(
      {
        words: []
      }
    )
    expect(parseTranscribeResponse({})).toEqual({ words: [] })
  })

  it('interação com status de falha vira resposta inválida', () => {
    expect(() => parseTranscribeResponse({ status: 'failed' })).toThrow(AiError)
  })
})
