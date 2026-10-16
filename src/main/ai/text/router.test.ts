import { describe, expect, it } from 'vitest'
import { AiError } from '../errors'
import { TextRouter, type TextRouterDeps } from './router'
import type { TextBackend, TextCompletion, TextRequest } from './types'

const REQUEST: TextRequest = {
  system: 'sistema',
  messages: [{ role: 'user', content: 'pergunta' }],
  maxOutputTokens: 100
}

interface Calls {
  groq: string[]
  gemini: string[]
  logs: string[]
}

type Behavior =
  TextCompletion | AiError | ((onDelta?: (text: string) => void) => Promise<TextCompletion>)

function backend(calls: string[], behavior: Behavior): TextBackend {
  return {
    async run(model, _request, _signal, onDelta) {
      calls.push(model)
      if (behavior instanceof AiError) throw behavior
      if (typeof behavior === 'function') return behavior(onDelta)
      onDelta?.(behavior.text)
      return behavior
    }
  }
}

function setup(options: {
  groqKey?: string | null
  geminiKey?: string | null
  groq?: Behavior
  gemini?: Behavior
}) {
  const calls: Calls = { groq: [], gemini: [], logs: [] }
  const deps: TextRouterDeps = {
    groqKey: () => options.groqKey ?? null,
    geminiKey: () => options.geminiKey ?? null,
    groqModel: () => 'groq-model',
    geminiModel: () => 'gemini-model',
    createGroq: () => backend(calls.groq, options.groq ?? { text: 'da groq', truncated: false }),
    createGemini: () =>
      backend(calls.gemini, options.gemini ?? { text: 'do gemini', truncated: false }),
    log: (message) => calls.logs.push(message)
  }
  return { router: new TextRouter(deps), calls }
}

const signal = new AbortController().signal

describe('TextRouter', () => {
  it('usa a Groq quando há chave e informa o provedor e o modelo', async () => {
    const { router, calls } = setup({ groqKey: 'g', geminiKey: 'k' })
    const result = await router.run(REQUEST, signal)
    expect(result).toEqual({
      text: 'da groq',
      truncated: false,
      provider: 'groq',
      model: 'groq-model'
    })
    expect(calls.gemini).toEqual([])
  })

  it('funciona só com a chave do Gemini', async () => {
    const { router, calls } = setup({ geminiKey: 'k' })
    const result = await router.run(REQUEST, signal)
    expect(result).toMatchObject({ text: 'do gemini', provider: 'gemini', model: 'gemini-model' })
    expect(calls.groq).toEqual([])
  })

  it('sem nenhuma chave, pede para configurar', async () => {
    const { router } = setup({})
    expect(router.hasProvider()).toBe(false)
    await expect(router.run(REQUEST, signal)).rejects.toMatchObject({ kind: 'invalid-key' })
  })

  it.each(['too-large', 'quota', 'unavailable', 'invalid-key', 'model', 'bad-request'] as const)(
    'cai no Gemini quando a Groq falha por "%s"',
    async (kind) => {
      const { router, calls } = setup({
        groqKey: 'g',
        geminiKey: 'k',
        groq: new AiError(kind, 'falhou')
      })
      const result = await router.run(REQUEST, signal)
      expect(result).toMatchObject({ provider: 'gemini', text: 'do gemini' })
      expect(calls.groq).toEqual(['groq-model'])
      expect(calls.logs.join(' ')).toContain(kind)
    }
  )

  it('não cai no Gemini sem rede nem quando o usuário cancela', async () => {
    for (const kind of ['network', 'cancelled'] as const) {
      const { router, calls } = setup({
        groqKey: 'g',
        geminiKey: 'k',
        groq: new AiError(kind, 'x')
      })
      await expect(router.run(REQUEST, signal)).rejects.toMatchObject({ kind })
      expect(calls.gemini).toEqual([])
    }
  })

  it('Groq falhou e não há chave do Gemini: o erro orienta a configurá-la', async () => {
    const { router } = setup({ groqKey: 'g', groq: new AiError('too-large', 'Grande demais.') })
    const error = await router.run(REQUEST, signal).catch((e: unknown) => e as AiError)
    expect(error).toBeInstanceOf(AiError)
    expect((error as AiError).kind).toBe('too-large')
    expect((error as AiError).message).toContain('chave do Gemini')
  })

  it('se o Gemini também falha, o erro dele é o que sobe', async () => {
    const { router } = setup({
      groqKey: 'g',
      geminiKey: 'k',
      groq: new AiError('quota', 'groq'),
      gemini: new AiError('unavailable', 'gemini')
    })
    await expect(router.run(REQUEST, signal)).rejects.toMatchObject({ message: 'gemini' })
  })

  it('em streaming, entrega os pedaços e cai no Gemini se a Groq falha antes de responder', async () => {
    const { router } = setup({
      groqKey: 'g',
      geminiKey: 'k',
      groq: new AiError('too-large', 'x')
    })
    const received: string[] = []
    const result = await router.run(REQUEST, signal, { onDelta: (t) => received.push(t) })
    expect(result.provider).toBe('gemini')
    expect(received).toEqual(['do gemini'])
  })

  it('se a Groq falha depois de já ter respondido, não troca de provedor (evita texto duplicado)', async () => {
    const { router, calls } = setup({
      groqKey: 'g',
      geminiKey: 'k',
      groq: (onDelta) => {
        onDelta?.('parte')
        return Promise.reject(new AiError('unavailable', 'caiu'))
      }
    })
    const received: string[] = []
    await expect(
      router.run(REQUEST, signal, { onDelta: (t) => received.push(t) })
    ).rejects.toMatchObject({ kind: 'unavailable' })
    expect(received).toEqual(['parte'])
    expect(calls.gemini).toEqual([])
  })
})
