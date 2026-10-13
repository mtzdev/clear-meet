import { describe, expect, it } from 'vitest'
import { GROQ_MODELS_URL, testApiKey } from './test-key'

const KEY = 'AIzaSyDUMMY-key-0000000001'

function fetchReturning(response: Response | Error): { fn: typeof fetch; urls: string[] } {
  const urls: string[] = []
  const fn = ((url: string | URL) => {
    urls.push(String(url))
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
  }) as typeof fetch
  return { fn, urls }
}

const body = (status: number, message: string): Response =>
  new Response(JSON.stringify({ error: { message } }), { status })

describe('testApiKey', () => {
  it('Gemini: chave boa passa, consultando o modelo escolhido', async () => {
    const { fn, urls } = fetchReturning(new Response('{}', { status: 200 }))
    expect(await testApiKey('gemini', KEY, { fetch: fn, geminiModel: 'gemini-3.6-flash' })).toEqual(
      {
        ok: true
      }
    )
    expect(urls[0]).toContain('/models/gemini-3.6-flash')
    expect(urls[0]).not.toContain(KEY)
  })

  it('Gemini: chave inválida, cota e rede têm mensagens próprias', async () => {
    const invalid = await testApiKey('gemini', KEY, {
      fetch: fetchReturning(body(400, 'API key not valid. Please pass a valid API key.')).fn,
      geminiModel: 'm'
    })
    expect(invalid).toMatchObject({ ok: false, kind: 'invalid-key' })

    const quota = await testApiKey('gemini', KEY, {
      fetch: fetchReturning(body(429, 'Resource has been exhausted')).fn,
      geminiModel: 'm'
    })
    expect(quota).toMatchObject({ ok: false, kind: 'quota' })

    const offline = await testApiKey('gemini', KEY, {
      fetch: fetchReturning(new TypeError('fetch failed')).fn,
      geminiModel: 'm'
    })
    expect(offline).toMatchObject({ ok: false, kind: 'network' })
    for (const result of [invalid, quota, offline]) {
      expect(JSON.stringify(result)).not.toContain(KEY)
    }
  })

  it('Groq: lista os modelos com a chave como Bearer', async () => {
    const calls: { url: string; auth: string | null }[] = []
    const fn = ((url: string | URL, init: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init.headers).get('authorization') })
      return Promise.resolve(new Response('{}', { status: 200 }))
    }) as typeof fetch
    expect(
      await testApiKey('groq', 'gsk_dummy_000000000001', { fetch: fn, geminiModel: 'm' })
    ).toEqual({
      ok: true
    })
    expect(calls).toEqual([{ url: GROQ_MODELS_URL, auth: 'Bearer gsk_dummy_000000000001' }])

    const denied = await testApiKey('groq', 'gsk_dummy_000000000001', {
      fetch: fetchReturning(body(401, 'Invalid API Key')).fn,
      geminiModel: 'm'
    })
    expect(denied).toMatchObject({ ok: false, kind: 'invalid-key' })
  })
})
