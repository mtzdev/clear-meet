/** Provedores de IA com chave guardada no app. */
export const AI_PROVIDERS = ['gemini', 'groq'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value)
}

export const AI_PROVIDER_LABEL: Record<AiProvider, string> = {
  gemini: 'Gemini',
  groq: 'Groq'
}

/** Onde o usuário obtém cada chave (o main só abre estes endereços). */
export const API_KEY_LINKS: Record<AiProvider, string> = {
  gemini: 'https://aistudio.google.com/apikey',
  groq: 'https://console.groq.com/keys'
}

export interface TranscriptionModelOption {
  id: string
  label: string
  hint: string
}

/** Modelos do Gemini que aceitam áudio e saída em JSON estruturado; o primeiro é o padrão. */
export const TRANSCRIPTION_MODELS: readonly TranscriptionModelOption[] = [
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    hint: 'Mais barato (cerca de US$ 0,04 por hora) e funcionou bem numa Reunião real (padrão)'
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    hint: 'Cerca de US$ 0,09 por hora; pode ficar sobrecarregado'
  },
  {
    id: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    hint: 'O mais capaz da família Flash, mas esteve indisponível (erros 503 e 429) nos testes'
  }
]

export const DEFAULT_TRANSCRIPTION_MODEL = 'gemini-3.5-flash-lite'

/** Outro modelo para tentar quando o escolhido falha: o primeiro da lista que não seja ele. */
export function alternativeModel(current: string | null): TranscriptionModelOption {
  return (
    TRANSCRIPTION_MODELS.find((model) => model.id !== current) ??
    (TRANSCRIPTION_MODELS[0] as TranscriptionModelOption)
  )
}

export function isTranscriptionModel(value: unknown): value is string {
  return typeof value === 'string' && TRANSCRIPTION_MODELS.some((model) => model.id === value)
}

/** O renderer nunca recebe a chave: só se existe e os últimos 4 caracteres. */
export interface KeyStatus {
  configured: boolean
  last4: string | null
}

export interface AiStatus {
  /** `safeStorage` (DPAPI) disponível; sem ele nenhuma chave é salva. */
  encryptionAvailable: boolean
  keys: Record<AiProvider, KeyStatus>
}

export type AiErrorKind =
  | 'invalid-key'
  | 'quota'
  | 'network'
  | 'unavailable'
  | 'model'
  | 'blocked'
  | 'bad-request'
  | 'bad-response'
  | 'cancelled'
  | 'unknown'

export type KeyTestResult = { ok: true } | { ok: false; kind: AiErrorKind; message: string }

const MIN_KEY_LENGTH = 16
const MAX_KEY_LENGTH = 256

/** Chave sem espaços nas pontas; `null` se vazia, com espaços no meio ou com tamanho absurdo. */
export function normalizeApiKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim()
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) return null
  return /\s/.test(key) ? null : key
}
