import { AI_MESSAGES, AiError, classifyHttpError, isAiError } from './errors'
import { abortError, networkError, sendWithRetry, sleepWithAbort, type RetryDeps } from './http'
import { readSse } from './sse'

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'

export interface OpenAiMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface OpenAiChatRequest {
  model: string
  system: string
  /** Conversa até a última pergunta do usuário. */
  messages: OpenAiMessage[]
  /** Saída estruturada: JSON Schema (`strict` garante o formato) ou só "JSON válido". */
  json?: { name: string; schema: object; strict: boolean } | 'object'
  maxOutputTokens?: number
  /** Só para modelos de raciocínio. */
  reasoningEffort?: 'low' | 'medium' | 'high'
}

export interface OpenAiChatResult {
  text: string
  /** A resposta parou no limite de tokens de saída (o texto pode estar cortado). */
  truncated: boolean
}

export interface OpenAiDeps extends RetryDeps {
  baseUrl: string
}

export const DEFAULT_OPENAI_DEPS: OpenAiDeps = {
  fetch: (input, init) => fetch(input, init),
  sleep: sleepWithAbort,
  random: Math.random,
  baseUrl: GROQ_BASE_URL,
  // Limite por minuto zera em segundos; esperas longas (cota diária, por exemplo) não valem a pena:
  // o erro sobe rápido e o Gemini assume.
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  maxWaitMs: 20_000,
  requestTimeoutMs: 2 * 60_000
}

/**
 * Cliente mínimo de qualquer API compatível com a da OpenAI (`/chat/completions`) por `fetch`.
 * A chave segue só no cabeçalho `Authorization`, nunca na URL, e nunca entra em mensagens de erro.
 */
export class OpenAiCompatClient {
  private readonly deps: OpenAiDeps

  constructor(
    private readonly apiKey: string,
    deps: Partial<OpenAiDeps> = {}
  ) {
    this.deps = { ...DEFAULT_OPENAI_DEPS, ...deps }
  }

  async chat(request: OpenAiChatRequest, signal?: AbortSignal): Promise<OpenAiChatResult> {
    const response = await this.post(request, false, signal)
    let raw: unknown
    try {
      raw = await response.json()
    } catch {
      throw new AiError('bad-response', AI_MESSAGES['bad-response'])
    }
    return parseCompletion(raw)
  }

  /** Como `chat`, mas devolve o texto aos poucos (`onDelta`) por SSE. */
  async chatStream(
    request: OpenAiChatRequest,
    onDelta: (text: string) => void,
    signal?: AbortSignal
  ): Promise<OpenAiChatResult> {
    const response = await this.post(request, true, signal)
    let text = ''
    let truncated = false
    try {
      await readSse(response, (data) => {
        if (data.trim() === '[DONE]') return
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

  private post(
    request: OpenAiChatRequest,
    stream: boolean,
    signal: AbortSignal | undefined
  ): Promise<Response> {
    return sendWithRetry(
      this.deps,
      `${this.deps.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(buildBody(request, stream))
      },
      signal
    )
  }
}

export function buildBody(request: OpenAiChatRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: [{ role: 'system', content: request.system }, ...request.messages],
    stream
  }
  if (request.maxOutputTokens) body.max_completion_tokens = request.maxOutputTokens
  if (request.reasoningEffort) body.reasoning_effort = request.reasoningEffort
  if (request.json === 'object') {
    body.response_format = { type: 'json_object' }
  } else if (request.json) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: request.json.name,
        strict: request.json.strict,
        schema: request.json.schema
      }
    }
  }
  return body
}

interface RawChoice {
  message?: { content?: unknown; refusal?: unknown }
  delta?: { content?: unknown }
  finish_reason?: unknown
}

export function parseCompletion(raw: unknown): OpenAiChatResult {
  const choice = (raw as { choices?: RawChoice[] } | null)?.choices?.[0]
  if (!choice) throw new AiError('bad-response', AI_MESSAGES['bad-response'])
  const finish = typeof choice.finish_reason === 'string' ? choice.finish_reason : ''
  if (finish === 'content_filter' || (choice.message?.refusal && !choice.message.content)) {
    throw new AiError('blocked', AI_MESSAGES.blocked)
  }
  const text = typeof choice.message?.content === 'string' ? choice.message.content : ''
  return { text, truncated: finish === 'length' }
}

export function parseStreamChunk(data: string): { text: string; truncated: boolean } {
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    return { text: '', truncated: false }
  }
  const body = raw as { error?: unknown; choices?: RawChoice[] } | null
  if (body?.error) throw classifyHttpError(500, data)
  const choice = body?.choices?.[0]
  if (!choice) return { text: '', truncated: false }
  const finish = typeof choice.finish_reason === 'string' ? choice.finish_reason : ''
  if (finish === 'content_filter') throw new AiError('blocked', AI_MESSAGES.blocked)
  return {
    text: typeof choice.delta?.content === 'string' ? choice.delta.content : '',
    truncated: finish === 'length'
  }
}
