import { AI_MESSAGES, AiError, classifyHttpError, isAiError } from './errors'

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com'

export interface GeminiFile {
  /** `files/abc123`: identifica o arquivo para consultar e apagar. */
  name: string
  /** Endereço a citar no pedido de geração. */
  uri: string
  mimeType: string
  state: 'PROCESSING' | 'ACTIVE' | 'FAILED' | 'UNKNOWN'
}

export type GeminiPart = { text: string } | { fileData: { mimeType: string; fileUri: string } }

export interface GenerateRequest {
  model: string
  parts: GeminiPart[]
  systemInstruction?: string
  /** JSON Schema da resposta; liga o modo de saída estruturada. */
  jsonSchema?: object
  maxOutputTokens?: number
}

export interface GenerateResult {
  text: string
  /** A resposta parou no limite de tokens de saída (o texto pode estar cortado). */
  truncated: boolean
}

export interface GeminiDeps {
  fetch: typeof fetch
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  /** Número em [0, 1) para o jitter do backoff. */
  random(): number
  baseUrl: string
  /** Tentativas por chamada (a primeira conta). */
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  requestTimeoutMs: number
  activePollMs: number
  activeTimeoutMs: number
  /** Aviso de cada nova tentativa (sem dados do pedido nem a chave). */
  log?: (message: string) => void
}

const sleepWithAbort = (ms: number, signal?: AbortSignal): Promise<void> =>
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

function abortError(): AiError {
  return new AiError('cancelled', AI_MESSAGES.cancelled)
}

export const DEFAULT_GEMINI_DEPS: GeminiDeps = {
  fetch: (input, init) => fetch(input, init),
  sleep: sleepWithAbort,
  random: Math.random,
  baseUrl: GEMINI_BASE_URL,
  // Sobrecarga (503) costuma durar minutos: 2 + 4 + 8 + 16 + 32 + 60 s, cerca de 2 min por chamada.
  maxAttempts: 7,
  baseDelayMs: 2000,
  maxDelayMs: 60_000,
  requestTimeoutMs: 5 * 60_000,
  activePollMs: 2000,
  activeTimeoutMs: 2 * 60_000
}

function toFileState(value: unknown): GeminiFile['state'] {
  return value === 'PROCESSING' || value === 'ACTIVE' || value === 'FAILED' ? value : 'UNKNOWN'
}

function toGeminiFile(raw: unknown): GeminiFile {
  const record = (raw as { file?: unknown } | null)?.file ?? raw
  const file = record as Record<string, unknown> | null
  if (
    !file ||
    typeof file.name !== 'string' ||
    typeof file.uri !== 'string' ||
    typeof file.mimeType !== 'string'
  ) {
    throw new AiError('bad-response', AI_MESSAGES['bad-response'])
  }
  return { name: file.name, uri: file.uri, mimeType: file.mimeType, state: toFileState(file.state) }
}

/**
 * Cliente mínimo da API do Gemini por `fetch` (sem SDK): File API para o áudio e
 * `generateContent` para texto e JSON estruturado. A chave segue só no cabeçalho
 * `x-goog-api-key`, nunca na URL, e nunca entra em mensagens de erro.
 */
export class GeminiClient {
  private readonly deps: GeminiDeps

  constructor(
    private readonly apiKey: string,
    deps: Partial<GeminiDeps> = {}
  ) {
    this.deps = { ...DEFAULT_GEMINI_DEPS, ...deps }
  }

  /** Confere a chave e o modelo sem gastar cota de geração. Lança `AiError`. */
  async verify(model: string, signal?: AbortSignal): Promise<void> {
    const response = await this.send(
      `${this.deps.baseUrl}/v1beta/models/${encodeURIComponent(model)}`,
      { method: 'GET' },
      signal
    )
    await response.arrayBuffer().catch(() => undefined)
  }

  /** Envia o arquivo (protocolo resumable em duas etapas). */
  async uploadFile(
    input: { data: Uint8Array; mimeType: string; displayName: string },
    signal?: AbortSignal
  ): Promise<GeminiFile> {
    const start = await this.send(
      `${this.deps.baseUrl}/upload/v1beta/files`,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(input.data.byteLength),
          'X-Goog-Upload-Header-Content-Type': input.mimeType,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ file: { display_name: input.displayName } })
      },
      signal
    )
    const uploadUrl = start.headers.get('x-goog-upload-url')
    await start.arrayBuffer().catch(() => undefined)
    if (!uploadUrl) throw new AiError('bad-response', AI_MESSAGES['bad-response'])

    const finish = await this.send(
      uploadUrl,
      {
        method: 'POST',
        headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
        body: input.data
      },
      signal,
      false
    )
    return toGeminiFile(await this.readJson(finish))
  }

  /** Espera o arquivo ficar `ACTIVE` (pronto para uso). */
  async waitUntilActive(file: GeminiFile, signal?: AbortSignal): Promise<GeminiFile> {
    let current = file
    const deadline = Date.now() + this.deps.activeTimeoutMs
    while (current.state !== 'ACTIVE') {
      if (current.state === 'FAILED') {
        throw new AiError('bad-response', 'A IA não conseguiu processar o áudio enviado.')
      }
      if (Date.now() >= deadline) {
        throw new AiError('unavailable', AI_MESSAGES.unavailable, { retryable: true })
      }
      await this.deps.sleep(this.deps.activePollMs, signal)
      const response = await this.send(
        `${this.deps.baseUrl}/v1beta/${current.name}`,
        { method: 'GET' },
        signal
      )
      current = toGeminiFile(await this.readJson(response))
    }
    return current
  }

  /** Apaga o arquivo do Gemini. Nunca lança: é limpeza, e os arquivos expiram em 48 h de qualquer jeito. */
  async deleteFile(name: string): Promise<void> {
    try {
      const response = await this.deps.fetch(`${this.deps.baseUrl}/v1beta/${name}`, {
        method: 'DELETE',
        headers: { 'x-goog-api-key': this.apiKey },
        signal: AbortSignal.timeout(30_000)
      })
      await response.arrayBuffer().catch(() => undefined)
    } catch {
      // Sem rede ou sem resposta: o arquivo expira sozinho.
    }
  }

  /** `generateContent` com texto, arquivos e (opcional) saída em JSON estruturado. */
  async generate(request: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
    const generationConfig: Record<string, unknown> = {}
    if (request.jsonSchema) {
      generationConfig.responseMimeType = 'application/json'
      generationConfig.responseJsonSchema = request.jsonSchema
    }
    if (request.maxOutputTokens) generationConfig.maxOutputTokens = request.maxOutputTokens

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: request.parts }],
      generationConfig
    }
    if (request.systemInstruction) {
      body.systemInstruction = { parts: [{ text: request.systemInstruction }] }
    }

    const response = await this.send(
      `${this.deps.baseUrl}/v1beta/models/${encodeURIComponent(request.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      },
      signal
    )
    return parseGenerateResponse(await this.readJson(response))
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json()
    } catch {
      throw new AiError('bad-response', AI_MESSAGES['bad-response'])
    }
  }

  /**
   * Uma chamada HTTP com novas tentativas (backoff exponencial com jitter, respeitando o
   * `Retry-After`/`retryDelay`) para 429, 5xx e falhas de rede. Lança `AiError`.
   */
  private async send(
    url: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    withKey = true
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    if (withKey) headers.set('x-goog-api-key', this.apiKey)

    let lastError: AiError | null = null
    for (let attempt = 1; attempt <= this.deps.maxAttempts; attempt++) {
      if (signal?.aborted) throw abortError()
      try {
        const timeout = AbortSignal.timeout(this.deps.requestTimeoutMs)
        const response = await this.deps.fetch(url, {
          ...init,
          headers,
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout
        })
        if (response.ok) return response
        const text = await response.text().catch(() => '')
        lastError = classifyHttpError(response.status, text, response.headers)
      } catch (error) {
        if (signal?.aborted) throw abortError()
        lastError = isAiError(error) ? error : networkError(error)
      }
      if (!lastError.retryable || attempt >= this.deps.maxAttempts) throw lastError
      const waitMs = this.backoffMs(attempt, lastError.options.retryAfterMs)
      this.deps.log?.(
        `[ia] tentativa ${attempt} de ${this.deps.maxAttempts} falhou (${lastError.kind}${
          lastError.options.status ? `, HTTP ${lastError.options.status}` : ''
        }); nova tentativa em ${Math.round(waitMs / 1000)} s`
      )
      await this.deps.sleep(waitMs, signal)
    }
    throw lastError ?? new AiError('unknown', AI_MESSAGES.unknown)
  }

  private backoffMs(attempt: number, hintMs: number | undefined): number {
    const exponential = this.deps.baseDelayMs * 2 ** (attempt - 1)
    const jitter = 1 + (this.deps.random() - 0.5) * 0.5
    const computed = Math.min(exponential * jitter, this.deps.maxDelayMs)
    return Math.min(Math.max(computed, hintMs ?? 0), this.deps.maxDelayMs * 2)
  }
}

function networkError(error: unknown): AiError {
  const timedOut = error instanceof Error && error.name === 'TimeoutError'
  return timedOut
    ? new AiError('unavailable', AI_MESSAGES.unavailable, { retryable: true })
    : new AiError('network', AI_MESSAGES.network, { retryable: true })
}

interface RawCandidate {
  content?: { parts?: { text?: unknown }[] }
  finishReason?: unknown
}

export function parseGenerateResponse(raw: unknown): GenerateResult {
  const body = raw as { candidates?: RawCandidate[]; promptFeedback?: { blockReason?: unknown } }
  const candidate = body?.candidates?.[0]
  if (!candidate) {
    if (body?.promptFeedback?.blockReason) throw new AiError('blocked', AI_MESSAGES.blocked)
    throw new AiError('bad-response', AI_MESSAGES['bad-response'])
  }
  const finish = typeof candidate.finishReason === 'string' ? candidate.finishReason : ''
  if (['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION', 'SPII'].includes(finish)) {
    throw new AiError('blocked', AI_MESSAGES.blocked)
  }
  const text = (candidate.content?.parts ?? [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
  return { text, truncated: finish === 'MAX_TOKENS' }
}
