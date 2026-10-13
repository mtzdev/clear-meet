import type { Speaker } from '@shared/transcript'

/** Fala como o Gemini a devolve: `speaker` já é o rótulo ("Ana" ou "Falante 2") e `startMs` é relativo ao bloco. */
export interface RawUtterance {
  speaker: string
  startMs: number
  text: string
}

export class ChunkParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChunkParseError'
  }
}

/** Fala além do fim do bloco por mais que isto é lixo (a IA inventou o Instante). */
const END_TOLERANCE_MS = 5000

const MAX_NAME_LENGTH = 40
const MAX_NAME_WORDS = 5
const NOT_A_NAME =
  /^(?:desconhecid[oa]|unknown|n\/?a|none|null|undefined|narrador|narrator|speaker|falante|participante|participant|voz|voice|pessoa|person|host|guest|interlocutor)$/i

/** "Falante 2", "speaker 2" e afins: rótulo genérico, não um nome. */
function genericNumber(text: string): number | null {
  const match = /^(?:falante|speaker|participante|participant)\s*#?\s*(\d+)$/i.exec(text.trim())
  return match ? Number(match[1]) : null
}

/**
 * Nome de Falante aceitável ou `null`. Barra o que a IA coloca no campo por engano: horários
 * ("11:20"), números, frases, descrições e rótulos genéricos.
 */
export function sanitizeSpeakerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\s+/g, ' ').trim()
  if (name.length < 2 || name.length > MAX_NAME_LENGTH) return null
  if (genericNumber(name) !== null || NOT_A_NAME.test(name)) return null
  if (/\d/.test(name)) return null
  if (!/\p{L}/u.test(name)) return null
  if (/[:;!?()[\]{}<>@/\\]/.test(name)) return null
  if (name.split(' ').length > MAX_NAME_WORDS) return null
  return name
}

/** `MM:SS`, `H:MM:SS` ou com décimos (`01:05.5`). Qualquer outra coisa = `null`. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : null
  }
  if (typeof value !== 'string') return null
  const parts = value.trim().replace(',', '.').split(':')
  if (parts.length < 2 || parts.length > 3) return null
  let seconds = 0
  for (const part of parts) {
    if (!/^\d+(\.\d+)?$/.test(part)) return null
    seconds = seconds * 60 + Number(part)
  }
  return Math.round(seconds * 1000)
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

/** Resposta cortada no meio (limite de tokens): fecha o JSON depois da última Fala completa. */
function salvageTruncated(text: string): unknown {
  const end = text.lastIndexOf('}')
  if (end < 0) return undefined
  const head = text.slice(0, end + 1)
  for (const closing of [']}', '}']) {
    try {
      return JSON.parse(head + closing)
    } catch {
      // tenta o próximo fechamento
    }
  }
  return undefined
}

function listOf(value: unknown): unknown[] | null {
  return Array.isArray(value) ? (value as unknown[]) : null
}

interface SpeakerLabels {
  /** Rótulo de um `speakerId` da resposta. */
  byId: Map<string, string>
  /** Rótulo quando a Fala cita um id que a lista não declarou. */
  fallback(id: unknown): string
}

/**
 * Monta os rótulos a partir da lista `speakers` da resposta. Quem não tem nome plausível vira
 * "Falante N", com N tirado do id (`s2` é "Falante 2"); sem número no id, vale a posição na lista.
 */
function labelSpeakers(speakers: unknown[], known: readonly Speaker[]): SpeakerLabels {
  const byId = new Map<string, string>()
  speakers.forEach((item, index) => {
    if (typeof item !== 'object' || item === null) return
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id.trim() === '') return
    const id = record.id.trim()
    const digits = /\d+/.exec(id)
    const number = digits ? Number(digits[0]) : index + 1
    // Um id reaproveitado dos blocos anteriores guarda o nome que já tinha.
    const earlier = known.find((speaker) => speaker.id === id)?.name ?? null
    byId.set(id, sanitizeSpeakerName(record.name) ?? earlier ?? `Falante ${number}`)
  })
  return {
    byId,
    fallback: (id) => {
      const digits = typeof id === 'string' ? /\d+/.exec(id) : null
      return `Falante ${digits ? Number(digits[0]) : 1}`
    }
  }
}

/** Formato antigo (rótulo em cada Fala): só "Falante N" é aproveitado; o resto cai no Falante 1. */
function legacyNumber(raw: unknown): number {
  return (typeof raw === 'string' ? genericNumber(raw) : null) ?? 1
}

/**
 * Interpreta a resposta do Gemini para um bloco de `chunkDurationMs`: `speakers` (id e nome ou
 * `null`) e `utterances` (cada uma com `speakerId`, `start` e `text`). Descarta o que não presta
 * (texto vazio, Instante ilegível ou além do fim do bloco), limita ao fim do bloco e ordena.
 * Lança `ChunkParseError` se a resposta não é a lista esperada.
 */
export function parseChunkResponse(
  text: string,
  chunkDurationMs: number,
  known: readonly Speaker[] = []
): { utterances: RawUtterance[]; salvaged: boolean } {
  const cleaned = stripFences(text)
  let parsed: unknown
  let salvaged = false
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    parsed = salvageTruncated(cleaned)
    salvaged = parsed !== undefined
  }
  const root =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  const items = Array.isArray(parsed) ? (parsed as unknown[]) : listOf(root?.utterances)
  if (!items) throw new ChunkParseError('A resposta da IA não tem a lista de Falas esperada.')
  const labels = labelSpeakers(listOf(root?.speakers) ?? [], known)

  const utterances: RawUtterance[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const content = typeof record.text === 'string' ? record.text.replace(/\s+/g, ' ').trim() : ''
    if (content === '') continue
    const startMs =
      record.start !== undefined
        ? parseTimestamp(record.start)
        : typeof record.startMs === 'number' && Number.isFinite(record.startMs)
          ? Math.round(record.startMs)
          : null
    if (startMs === null || startMs < 0 || startMs > chunkDurationMs + END_TOLERANCE_MS) continue
    const speaker =
      typeof record.speakerId === 'string'
        ? (labels.byId.get(record.speakerId.trim()) ?? labels.fallback(record.speakerId))
        : (sanitizeSpeakerName(record.speaker) ?? `Falante ${legacyNumber(record.speaker)}`)
    utterances.push({ speaker, startMs: Math.min(startMs, chunkDurationMs), text: content })
  }
  // Ordenação estável: Falas no mesmo Instante mantêm a ordem em que a IA as devolveu.
  utterances.sort((a, b) => a.startMs - b.startMs)
  return { utterances, salvaged }
}
