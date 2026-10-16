import { AI_MESSAGES, AiError, classifyHttpError, isAiError } from './errors'
import { abortError, networkError, sendWithRetry, sleepWithAbort, type RetryDeps } from './http'
import { readSse } from './sse'

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

/** Turno anterior de uma conversa (a pergunta atual vai em `parts`). */
export interface GeminiTurn {
  role: 'user' | 'model'
  text: string
}

export interface GenerateRequest {
  model: string
  /** Conteúdo do último turno do usuário. */
  parts: GeminiPart[]
  /** Turnos anteriores, em ordem. */
  history?: GeminiTurn[]
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

export interface TranscribeRequest {
  model: string
  fileUri: string
  mimeType: string
}

/** Palavra com Falante (`spk_1`) e tempos em ms desde o início do áudio enviado. */
export interface TranscribedWord {
  text: string
  speaker: string | null
  startMs: number
  endMs: number
}

export interface TranscribeResult {
  words: TranscribedWord[]
}

export const NO_DIARIZATION_MESSAGE = 'O modelo não devolveu a separação de vozes.'

export interface GeminiDeps extends RetryDeps {
  baseUrl: string
  activePollMs: number
  activeTimeoutMs: number
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
 * `generateContent` para texto e JSON estruturado e a Interactions API para o modelo dedicado de
 * transcrição. A chave segue só no cabeçalho `x-goog-api-key`, nunca na URL, e nunca entra em
 * mensagens de erro.
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

  /** `generateContent` com texto, arquivos e (opcional) saída em JSON estruturada. */
  async generate(request: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
    const response = await this.send(
      `${this.deps.baseUrl}/v1beta/models/${encodeURIComponent(request.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(request))
      },
      signal
    )
    return parseGenerateResponse(await this.readJson(response))
  }

  /**
   * Como `generate`, mas devolve o texto aos poucos (`onDelta`). Erros antes de a resposta
   * começar seguem as novas tentativas; depois disso, uma falha encerra a chamada.
   */
  async generateStream(
    request: GenerateRequest,
    onDelta: (text: string) => void,
    signal?: AbortSignal
  ): Promise<GenerateResult> {
    const response = await this.send(
      `${this.deps.baseUrl}/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(request))
      },
      signal
    )
    let text = ''
    let truncated = false
    try {
      await readSse(response, (data) => {
        const chunk = parseStreamChunk(data)
        if (chunk.text) {
          text += chunk.text
          onDelta(chunk.text)
        }
        if (chunk.truncated) truncated = true
      })
    } catch (error) {
      if (signal?.aborted) throw abortError()
      throw isAiError(error) ? error : networkError(error)
    }
    return { text, truncated }
  }

  /**
   * Interactions API com o modelo dedicado de transcrição: separação de vozes e tempo por
   * palavra. Lança `AiError` se a resposta não trouxer as palavras com Falante.
   */
  async transcribe(request: TranscribeRequest, signal?: AbortSignal): Promise<TranscribeResult> {
    const response = await this.send(
      `${this.deps.baseUrl}/v1beta/interactions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.model,
          input: [{ type: 'audio', uri: request.fileUri, mime_type: request.mimeType }],
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
      },
      signal
    )
    const raw = await this.readJson(response)
    try {
      return parseTranscribeResponse(raw)
    } catch (error) {
      if (isAiError(error) && error.message === NO_DIARIZATION_MESSAGE) {
        this.deps.log?.(`[ia] resposta da transcrição sem word_info:\n${describeStructure(raw)}`)
      }
      throw error
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json()
    } catch {
      throw new AiError('bad-response', AI_MESSAGES['bad-response'])
    }
  }

  private send(
    url: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    withKey = true
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    if (withKey) headers.set('x-goog-api-key', this.apiKey)
    return sendWithRetry(this.deps, url, { ...init, headers }, signal)
  }
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
  if (BLOCKED_FINISH.includes(finish)) {
    throw new AiError('blocked', AI_MESSAGES.blocked)
  }
  const text = (candidate.content?.parts ?? [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
  return { text, truncated: finish === 'MAX_TOKENS' }
}

const MAX_WALK_DEPTH = 10

const MAX_STRUCTURE_LINES = 40
const SHOWN_VALUE_KEYS = new Set(['type', 'status'])

function describeValue(key: string, value: unknown): string {
  if (typeof value === 'string') {
    return SHOWN_VALUE_KEYS.has(key) && /^[\w.-]{1,30}$/.test(value)
      ? `'${value}'`
      : `string(${value.length})`
  }
  if (Array.isArray(value)) return `array(${value.length})`
  if (value === null) return 'null'
  return typeof value === 'object' ? 'object' : typeof value
}

/**
 * Estrutura da resposta para diagnóstico: caminhos, nomes de chaves, tipos e tamanhos.
 * Nunca inclui o conteúdo dos textos (só o valor de `type` e `status`, curtos e fixos).
 */
export function describeStructure(raw: unknown): string {
  const lines: string[] = []
  const visit = (node: unknown, path: string, depth: number): void => {
    if (lines.length >= MAX_STRUCTURE_LINES || depth > MAX_WALK_DEPTH) return
    if (Array.isArray(node)) {
      node.slice(0, 3).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1))
      return
    }
    if (typeof node !== 'object' || node === null) return
    const record = node as Record<string, unknown>
    const fields = Object.entries(record)
      .map(([key, value]) => `${key.slice(0, 40)}:${describeValue(key, value)}`)
      .join(', ')
    lines.push(`${path || '$'}: {${fields}}`)
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'object' && value !== null) {
        visit(value, path ? `${path}.${key.slice(0, 40)}` : key.slice(0, 40), depth + 1)
      }
    }
  }
  visit(raw, '', 0)
  return lines.join('\n') || typeof raw
}

/** "0.450s", "12s" ou um número (segundos) para ms; qualquer outra coisa é `null`. */
export function parseOffsetMs(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : null
  }
  if (typeof value !== 'string') return null
  const match = /^\s*(\d+(?:\.\d+)?)\s*s?\s*$/.exec(value)
  return match ? Math.round(Number(match[1]) * 1000) : null
}

/**
 * Procura as anotações `word_info` em qualquer nível da resposta (a posição exata não é
 * garantida) e o texto corrido, para distinguir "áudio sem fala" de "veio sem palavras".
 */
export function parseTranscribeResponse(raw: unknown): TranscribeResult {
  const body = raw as { status?: unknown } | null
  if (
    typeof body?.status === 'string' &&
    ['failed', 'cancelled', 'incomplete'].includes(body.status)
  ) {
    throw new AiError('bad-response', AI_MESSAGES['bad-response'])
  }
  const words: TranscribedWord[] = []
  let hasText = false
  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_WALK_DEPTH || typeof node !== 'object' || node === null) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    const record = node as Record<string, unknown>
    if (record.type === 'word_info') {
      const startMs = parseOffsetMs(record.start_offset)
      const text = typeof record.text === 'string' ? record.text.trim() : ''
      if (startMs !== null && text !== '') {
        const endMs = parseOffsetMs(record.end_offset)
        const speaker =
          typeof record.speaker === 'string' && record.speaker.trim() !== ''
            ? record.speaker.trim()
            : null
        words.push({ text, speaker, startMs, endMs: Math.max(endMs ?? startMs, startMs) })
      }
      return
    }
    if (record.type === 'text' && typeof record.text === 'string' && record.text.trim() !== '') {
      hasText = true
    }
    for (const value of Object.values(record)) walk(value, depth + 1)
  }
  walk(raw, 0)

  if (words.length === 0) {
    if (hasText) throw new AiError('bad-response', NO_DIARIZATION_MESSAGE)
    return { words }
  }
  if (words.every((word) => word.speaker === null)) {
    throw new AiError('bad-response', NO_DIARIZATION_MESSAGE)
  }
  return { words }
}

function buildBody(request: GenerateRequest): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {}
  if (request.jsonSchema) {
    generationConfig.responseMimeType = 'application/json'
    generationConfig.responseJsonSchema = request.jsonSchema
  }
  if (request.maxOutputTokens) generationConfig.maxOutputTokens = request.maxOutputTokens

  const contents: unknown[] = (request.history ?? []).map((turn) => ({
    role: turn.role,
    parts: [{ text: turn.text }]
  }))
  contents.push({ role: 'user', parts: request.parts })
  const body: Record<string, unknown> = { contents, generationConfig }
  if (request.systemInstruction) {
    body.systemInstruction = { parts: [{ text: request.systemInstruction }] }
  }
  return body
}

const BLOCKED_FINISH = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION', 'SPII']

/** Um pedaço do `streamGenerateContent`: texto novo e se a resposta parou no limite de tokens. */
export function parseStreamChunk(data: string): { text: string; truncated: boolean } {
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    return { text: '', truncated: false }
  }
  const body = raw as {
    error?: { code?: unknown; message?: unknown }
    candidates?: RawCandidate[]
    promptFeedback?: { blockReason?: unknown }
  } | null
  if (body?.error) {
    const status = typeof body.error.code === 'number' ? body.error.code : 500
    throw classifyHttpError(status, data)
  }
  const candidate = body?.candidates?.[0]
  if (!candidate) {
    if (body?.promptFeedback?.blockReason) throw new AiError('blocked', AI_MESSAGES.blocked)
    return { text: '', truncated: false }
  }
  const finish = typeof candidate.finishReason === 'string' ? candidate.finishReason : ''
  if (BLOCKED_FINISH.includes(finish)) throw new AiError('blocked', AI_MESSAGES.blocked)
  const text = (candidate.content?.parts ?? [])
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
  return { text, truncated: finish === 'MAX_TOKENS' }
}
