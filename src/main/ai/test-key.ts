import type { AiProvider, KeyTestResult } from '@shared/ai'
import { AI_MESSAGES, AiError, classifyHttpError, isAiError } from './errors'
import { GeminiClient } from './gemini'

export const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models'

export interface TestKeyDeps {
  fetch: typeof fetch
  geminiModel: string
}

async function testGroq(key: string, fetchFn: typeof fetch): Promise<void> {
  let response: Response
  try {
    response = await fetchFn(GROQ_MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000)
    })
  } catch {
    throw new AiError('network', AI_MESSAGES.network)
  }
  if (response.ok) return
  throw classifyHttpError(response.status, await response.text().catch(() => ''), response.headers)
}

/**
 * Valida uma chave com uma chamada que não gasta cota de geração: consulta o modelo no
 * Gemini ou lista os modelos na Groq. Nunca lança; o erro volta com mensagem clara.
 */
export async function testApiKey(
  provider: AiProvider,
  key: string,
  deps: TestKeyDeps
): Promise<KeyTestResult> {
  try {
    if (provider === 'gemini') {
      // Sem novas tentativas: o teste responde rápido, mesmo com cota estourada.
      await new GeminiClient(key, { fetch: deps.fetch, maxAttempts: 1 }).verify(
        deps.geminiModel,
        AbortSignal.timeout(20_000)
      )
    } else {
      await testGroq(key, deps.fetch)
    }
    return { ok: true }
  } catch (error) {
    // O único cancelamento possível aqui é o tempo esgotado.
    if (isAiError(error) && error.kind === 'cancelled') {
      return { ok: false, kind: 'network', message: AI_MESSAGES.network }
    }
    if (isAiError(error)) return { ok: false, kind: error.kind, message: error.message }
    return { ok: false, kind: 'unknown', message: AI_MESSAGES.unknown }
  }
}
