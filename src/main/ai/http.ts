import { AI_MESSAGES, AiError, classifyHttpError, isAiError } from './errors'

/** O que as chamadas HTTP de IA precisam para tentar de novo com espera crescente. */
export interface RetryDeps {
  fetch: typeof fetch
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  /** Número em [0, 1) para o jitter do backoff. */
  random(): number
  /** Tentativas por chamada (a primeira conta). */
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  /** Espera máxima aceita entre tentativas; acima disso o erro sobe na hora. */
  maxWaitMs?: number
  requestTimeoutMs: number
  /** Aviso de cada nova tentativa (sem dados do pedido nem a chave). */
  log?: (message: string) => void
}

export function abortError(): AiError {
  return new AiError('cancelled', AI_MESSAGES.cancelled)
}

export const sleepWithAbort = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

export function networkError(error: unknown): AiError {
  const timedOut = error instanceof Error && error.name === 'TimeoutError'
  return timedOut
    ? new AiError('unavailable', AI_MESSAGES.unavailable, { retryable: true })
    : new AiError('network', AI_MESSAGES.network, { retryable: true })
}

function backoffMs(deps: RetryDeps, attempt: number, hintMs: number | undefined): number {
  const exponential = deps.baseDelayMs * 2 ** (attempt - 1)
  const jitter = 1 + (deps.random() - 0.5) * 0.5
  const computed = Math.min(exponential * jitter, deps.maxDelayMs)
  return Math.min(Math.max(computed, hintMs ?? 0), deps.maxDelayMs * 2)
}

/**
 * Uma chamada HTTP com novas tentativas (backoff exponencial com jitter, respeitando o
 * `Retry-After`/`retryDelay`) para 429, 5xx e falhas de rede. Lança `AiError`.
 */
export async function sendWithRetry(
  deps: RetryDeps,
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined
): Promise<Response> {
  let lastError: AiError | null = null
  for (let attempt = 1; attempt <= deps.maxAttempts; attempt++) {
    if (signal?.aborted) throw abortError()
    try {
      const timeout = AbortSignal.timeout(deps.requestTimeoutMs)
      const response = await deps.fetch(url, {
        ...init,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      })
      if (response.ok) return response
      const text = await response.text().catch(() => '')
      lastError = classifyHttpError(response.status, text, response.headers)
    } catch (error) {
      if (signal?.aborted) throw abortError()
      lastError = isAiError(error) ? error : networkError(error)
    }
    if (!lastError.retryable || attempt >= deps.maxAttempts) throw lastError
    const waitMs = backoffMs(deps, attempt, lastError.options.retryAfterMs)
    // O servidor pediu mais espera do que vale a pena: o erro sobe e quem chamou decide o que fazer.
    const asked = lastError.options.retryAfterMs ?? 0
    if (deps.maxWaitMs !== undefined && Math.max(waitMs, asked) > deps.maxWaitMs) throw lastError
    deps.log?.(
      `[ia] tentativa ${attempt} de ${deps.maxAttempts} falhou (${lastError.kind}${
        lastError.options.status ? `, HTTP ${lastError.options.status}` : ''
      }); nova tentativa em ${Math.round(waitMs / 1000)} s`
    )
    await deps.sleep(waitMs, signal)
  }
  throw lastError ?? new AiError('unknown', AI_MESSAGES.unknown)
}
