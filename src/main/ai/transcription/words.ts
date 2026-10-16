import type { TranscribedWord } from '../gemini'
import type { RawUtterance } from './parse'

/** Pausa entre duas palavras que separa uma Fala da outra, mesmo com o mesmo Falante. */
const PAUSE_BREAK_MS = 1500
/** Uma Fala que passou disto é quebrada na próxima pausa curta. */
const LONG_UTTERANCE_MS = 60_000
const SHORT_PAUSE_MS = 300
/** Folga para palavras logo depois do fim do bloco. */
const END_TOLERANCE_MS = 5000

const PUNCTUATION_ONLY = /^[.,;:!?…]+$/

/**
 * Agrupa as palavras (em ordem) em Falas: nova Fala quando o Falante muda, quando há pausa
 * longa ou, numa Fala já muito longa, na primeira pausa curta. Os Falantes viram "Falante N"
 * na ordem de aparição, somando `speakerBase` para os blocos nunca compartilharem rótulos:
 * quem é a mesma pessoa em dois blocos só é unido pela sobreposição, nunca por coincidência.
 */
export function groupWords(
  words: readonly TranscribedWord[],
  options: { chunkDurationMs: number; speakerBase?: number }
): RawUtterance[] {
  const base = options.speakerBase ?? 0
  const labels = new Map<string, string>()
  const labelOf = (id: string | null): string => {
    const key = id ?? ''
    let label = labels.get(key)
    if (!label) {
      label = `Falante ${base + labels.size + 1}`
      labels.set(key, label)
    }
    return label
  }

  const utterances: RawUtterance[] = []
  let current: { speaker: string; startMs: number; endMs: number; parts: string[] } | null = null
  let lastSpeakerId: string | null = null
  const flush = (): void => {
    if (current) {
      const text = current.parts.join(' ').replace(/\s+/g, ' ').trim()
      if (text !== '') {
        utterances.push({
          speaker: current.speaker,
          startMs: Math.min(current.startMs, options.chunkDurationMs),
          text
        })
      }
    }
    current = null
  }

  for (const word of words) {
    if (word.startMs > options.chunkDurationMs + END_TOLERANCE_MS) continue
    // Palavra sem Falante continua com o anterior.
    const speakerId: string | null = word.speaker ?? lastSpeakerId
    lastSpeakerId = speakerId
    const speaker = labelOf(speakerId)
    const gap = current ? word.startMs - current.endMs : 0
    const spoken = current ? word.startMs - current.startMs : 0
    const breaks =
      current !== null &&
      (current.speaker !== speaker ||
        gap > PAUSE_BREAK_MS ||
        (spoken > LONG_UTTERANCE_MS && gap >= SHORT_PAUSE_MS))
    if (breaks) flush()
    if (current === null) {
      current = { speaker, startMs: word.startMs, endMs: word.endMs, parts: [word.text] }
      continue
    }
    if (PUNCTUATION_ONLY.test(word.text)) {
      current.parts[current.parts.length - 1] += word.text
    } else {
      current.parts.push(word.text)
    }
    current.endMs = Math.max(current.endMs, word.endMs)
  }
  flush()
  utterances.sort((a, b) => a.startMs - b.startMs)
  return utterances
}
