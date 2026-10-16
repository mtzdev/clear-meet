import type { AiErrorKind } from '@shared/ai'

/** Erro de uma chamada de IA, já com a mensagem pronta para o usuário (pt-BR). */
export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly options: { status?: number; retryable?: boolean; retryAfterMs?: number } = {}
  ) {
    super(message)
    this.name = 'AiError'
  }

  get retryable(): boolean {
    return this.options.retryable === true
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError
}

/** Falhas em que insistir (nos outros blocos, por exemplo) é inútil ou prejudicial. */
export function isFatalKind(kind: AiErrorKind): boolean {
  return kind === 'invalid-key' || kind === 'model' || kind === 'cancelled'
}

export const AI_MESSAGES: Record<AiErrorKind, string> = {
  'invalid-key': 'A chave foi recusada. Confira se ela foi copiada inteira e se não foi revogada.',
  quota:
    'O limite de uso da chave foi atingido. Aguarde um pouco ou confira o plano e a cota do provedor.',
  network: 'Não foi possível falar com o servidor. Verifique a conexão com a internet.',
  unavailable: 'O serviço está sobrecarregado ou indisponível. Tente de novo em instantes.',
  model: 'O modelo escolhido não está disponível para esta chave.',
  blocked: 'A IA recusou processar este áudio.',
  'bad-request': 'A IA rejeitou o pedido.',
  'too-large': 'A Reunião é grande demais para este modelo ou para o limite do plano.',
  'bad-response': 'A IA devolveu uma resposta que não deu para interpretar.',
  cancelled: 'Cancelado.',
  unknown: 'Ocorreu um erro inesperado ao falar com a IA.'
}

interface ParsedBody {
  message: string
  status: string
  text: string
  retryDelayMs: number | null
}

function parseDelay(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim())
  return match ? Math.round(Number(match[1]) * 1000) : null
}

/** Lê o corpo de erro do Google (`{ error: { message, status, details } }`) ou da OpenAI/Groq. */
function parseBody(body: string): ParsedBody {
  let message = ''
  let status = ''
  let retryDelayMs: number | null = null
  try {
    const raw = JSON.parse(body) as unknown
    const error =
      typeof raw === 'object' && raw !== null ? (raw as { error?: unknown }).error : undefined
    if (typeof error === 'object' && error !== null) {
      const record = error as Record<string, unknown>
      if (typeof record.message === 'string') message = record.message
      if (typeof record.status === 'string') status = record.status
      if (Array.isArray(record.details)) {
        for (const detail of record.details) {
          const delay = parseDelay((detail as { retryDelay?: unknown } | null)?.retryDelay)
          if (delay !== null) retryDelayMs = delay
        }
      }
    }
  } catch {
    // Corpo que não é JSON: segue só com o código HTTP.
  }
  return { message, status, text: body, retryDelayMs }
}

function retryAfterHeader(headers: Headers | undefined): number | null {
  const value = headers?.get('retry-after')
  if (!value) return null
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null
}

const TOO_LARGE =
  /request too large|reduce your message size|context[_ ]length|maximum context|exceeds the maximum number of tokens|input token count|payload too large/i

/** Converte uma resposta HTTP de erro em `AiError`. Nunca inclui a chave nem o corpo bruto na mensagem. */
export function classifyHttpError(status: number, body: string, headers?: Headers): AiError {
  const parsed = parseBody(body)
  const haystack = `${parsed.message} ${parsed.status} ${parsed.text}`
  const retryAfterMs = parsed.retryDelayMs ?? retryAfterHeader(headers) ?? undefined

  if (
    status === 401 ||
    status === 403 ||
    /api[_ ]key (not valid|invalid)|API_KEY_INVALID|invalid_api_key/i.test(haystack)
  ) {
    return new AiError('invalid-key', AI_MESSAGES['invalid-key'], { status })
  }
  // O pedido nunca caberia: tentar de novo é inútil, e outro provedor pode aceitá-lo.
  if (status === 413 || ([400, 422, 429].includes(status) && TOO_LARGE.test(haystack))) {
    return new AiError('too-large', AI_MESSAGES['too-large'], { status })
  }
  if (status === 404) {
    return new AiError('model', AI_MESSAGES.model, { status })
  }
  if (status === 429) {
    // Cota diária esgotada: esperar alguns segundos não adianta.
    const daily = /PerDay|per day|daily/i.test(haystack)
    return new AiError('quota', AI_MESSAGES.quota, {
      status,
      retryable: !daily,
      retryAfterMs
    })
  }
  if (status === 408 || status >= 500) {
    return new AiError('unavailable', AI_MESSAGES.unavailable, {
      status,
      retryable: true,
      retryAfterMs
    })
  }
  if (status === 400) {
    return new AiError('bad-request', AI_MESSAGES['bad-request'], { status })
  }
  return new AiError('unknown', AI_MESSAGES.unknown, { status })
}
