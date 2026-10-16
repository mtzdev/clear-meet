import { isAiProvider, type AiProvider } from './ai'
import type { ParseResult } from './meeting'

export const CHAT_FILE = 'chat.json'
export const CHAT_SCHEMA_VERSION = 1

/** Tamanho máximo de uma pergunta. */
export const MAX_QUESTION_LENGTH = 4000
/** Mensagens guardadas no `chat.json`; as mais antigas saem. */
export const MAX_STORED_MESSAGES = 200
/** Quanto da Conversa vai à IA a cada pergunta (a Transcrição já ocupa quase todo o contexto). */
export const MAX_HISTORY_MESSAGES = 12
export const MAX_HISTORY_CHARS = 16_000

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
  /** Quem respondeu (só nas respostas). */
  provider?: AiProvider
  model?: string
  /** O usuário parou a geração: o texto está incompleto. */
  stopped?: boolean
}

export interface ChatFile {
  schemaVersion: typeof CHAT_SCHEMA_VERSION
  messages: ChatMessage[]
}

/** Resposta em geração: o texto que já chegou, para a UI retomar ao reabrir a aba. */
export interface ChatPending {
  messageId: string
  text: string
}

export interface ChatState {
  messages: ChatMessage[]
  pending: ChatPending | null
}

export interface ChatSent {
  /** A pergunta gravada; `null` ao repetir a última (sem pergunta nova). */
  user: ChatMessage | null
  /** Id da resposta que está sendo gerada (os eventos a citam). */
  assistantId: string
}

export type ChatEvent =
  | { type: 'delta'; meetingId: string; messageId: string; text: string }
  /** Resposta concluída ou interrompida pelo usuário (`message` é `null` se nada chegou). */
  | { type: 'done'; meetingId: string; messageId: string; message: ChatMessage | null }
  | { type: 'error'; meetingId: string; messageId: string; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMessage(item: unknown): ChatMessage | null {
  if (
    !isRecord(item) ||
    typeof item.id !== 'string' ||
    (item.role !== 'user' && item.role !== 'assistant') ||
    typeof item.text !== 'string' ||
    typeof item.createdAt !== 'string' ||
    Number.isNaN(Date.parse(item.createdAt))
  ) {
    return null
  }
  const message: ChatMessage = {
    id: item.id,
    role: item.role,
    text: item.text,
    createdAt: item.createdAt
  }
  if (isAiProvider(item.provider)) message.provider = item.provider
  if (typeof item.model === 'string' && item.model !== '') message.model = item.model
  if (item.stopped === true) message.stopped = true
  return message
}

export function parseChat(raw: unknown): ParseResult<ChatFile> {
  if (!isRecord(raw)) return { ok: false, error: 'chat.json não é um objeto' }
  if (raw.schemaVersion !== CHAT_SCHEMA_VERSION) {
    return { ok: false, error: 'versão do chat.json não suportada' }
  }
  if (!Array.isArray(raw.messages)) return { ok: false, error: 'messages inválido' }
  const messages: ChatMessage[] = []
  for (const [index, item] of raw.messages.entries()) {
    const message = parseMessage(item)
    if (!message) return { ok: false, error: `messages[${index}]: mensagem inválida` }
    messages.push(message)
  }
  return { ok: true, value: { schemaVersion: CHAT_SCHEMA_VERSION, messages } }
}

export function parseChatText(text: string): ParseResult<ChatFile> {
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return { ok: false, error: 'chat.json não é um JSON válido' }
  }
  return parseChat(raw)
}

export function serializeChat(chat: ChatFile): string {
  return `${JSON.stringify(chat, null, 2)}\n`
}

export interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * A Conversa que vai à IA: as últimas mensagens que cabem no limite, começando por uma
 * pergunta e terminando na pergunta atual. Mensagens seguidas do mesmo papel (uma pergunta
 * sem resposta, por erro) viram uma só, porque alguns provedores exigem papéis alternados.
 */
export function buildHistory(
  messages: readonly ChatMessage[],
  limits = { maxMessages: MAX_HISTORY_MESSAGES, maxChars: MAX_HISTORY_CHARS }
): HistoryTurn[] {
  const turns: HistoryTurn[] = []
  for (const message of messages) {
    if (message.text.trim() === '') continue
    const last = turns[turns.length - 1]
    if (last && last.role === message.role) last.content += `\n\n${message.text}`
    else turns.push({ role: message.role, content: message.text })
  }
  const recent = turns.slice(-limits.maxMessages)
  let chars = 0
  let keep = 0
  for (let i = recent.length - 1; i >= 0; i--) {
    chars += (recent[i] as HistoryTurn).content.length
    if (chars > limits.maxChars && keep > 0) break
    keep++
  }
  const kept = recent.slice(recent.length - keep)
  while (kept.length > 0 && (kept[0] as HistoryTurn).role !== 'user') kept.shift()
  return kept
}
