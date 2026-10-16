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

/**
 * Como o modelo transcreve: `generate` pede ao modelo de uso geral um JSON com as Falas;
 * `transcribe` usa o modelo dedicado de fala para texto, que já separa as vozes.
 */
export type TranscriptionEngine = 'generate' | 'transcribe'

export interface TranscriptionModelOption {
  id: string
  label: string
  hint: string
  engine: TranscriptionEngine
}

/** Modelos do Gemini para a Transcrição; o primeiro é o padrão. */
export const TRANSCRIPTION_MODELS: readonly TranscriptionModelOption[] = [
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    hint: 'Mais barato e rápido (padrão)',
    engine: 'generate'
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    hint: 'Mais preciso',
    engine: 'generate'
  },
  {
    id: 'gemini-3.5-transcribe',
    label: 'Gemini 3.5 Transcribe',
    hint: 'O mais fiel e que melhor separa as vozes; não identifica nomes',
    engine: 'transcribe'
  }
]

export function transcriptionEngine(model: string): TranscriptionEngine {
  return TRANSCRIPTION_MODELS.find((option) => option.id === model)?.engine ?? 'generate'
}

export const DEFAULT_TRANSCRIPTION_MODEL = 'gemini-3.5-flash-lite'

export interface TextModelOption {
  id: string
  label: string
  hint: string
}

export interface GroqTextModelOption extends TextModelOption {
  /** Aceita `response_format` com JSON Schema; os demais só devolvem "JSON válido". */
  structured: boolean
  /** Modelo de raciocínio: aceita `reasoning_effort`. */
  reasoning: boolean
}

/** Modelos de texto da Groq (Resumo e Conversa); o primeiro é o padrão. */
export const GROQ_TEXT_MODELS: readonly GroqTextModelOption[] = [
  {
    id: 'openai/gpt-oss-120b',
    label: 'GPT-OSS 120B',
    hint: 'Mais capaz (padrão)',
    structured: true,
    reasoning: true
  },
  {
    id: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B',
    hint: 'Boa alternativa',
    structured: false,
    reasoning: false
  },
  {
    id: 'llama-3.1-8b-instant',
    label: 'Llama 3.1 8B',
    hint: 'Muito rápido, respostas mais simples',
    structured: false,
    reasoning: false
  }
]

export const DEFAULT_GROQ_TEXT_MODEL = 'openai/gpt-oss-120b'

/** Modelos do Gemini para o Resumo e a Conversa (valem como reserva quando a Groq não atende). */
export const GEMINI_TEXT_MODELS: readonly TextModelOption[] = [
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    hint: 'Mais barato e rápido (padrão)'
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    hint: 'Respostas mais elaboradas'
  }
]

export const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-3.5-flash-lite'

export function groqTextModel(id: string): GroqTextModelOption | undefined {
  return GROQ_TEXT_MODELS.find((model) => model.id === id)
}

export function isGroqTextModel(value: unknown): value is string {
  return typeof value === 'string' && groqTextModel(value) !== undefined
}

export function isGeminiTextModel(value: unknown): value is string {
  return typeof value === 'string' && GEMINI_TEXT_MODELS.some((model) => model.id === value)
}

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
  | 'too-large'
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
