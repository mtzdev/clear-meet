import {
  assignSpeakers,
  genericSpeakerNumber,
  normalizeForSearch,
  type Speaker,
  type Utterance
} from '@shared/transcript'
import type { RawUtterance } from './parse'
import type { ChunkPlan } from './plan'

/** Fala já com o Instante da Reunião (não mais relativo ao bloco). */
export interface TimedUtterance {
  speaker: string
  startMs: number
  text: string
}

export interface ChunkResult {
  plan: ChunkPlan
  utterances: RawUtterance[]
}

/** Margem para casar Falas da sobreposição: os Instantes de dois blocos diferem alguns segundos. */
const MATCH_WINDOW_MS = 6000
const MIN_MATCH_SIMILARITY = 0.4
const MIN_VOTE_WEIGHT = 3
const SEAM_DUPLICATE_WINDOW_MS = 8000
const SEAM_DUPLICATE_SIMILARITY = 0.6

export function isGenericSpeaker(name: string): boolean {
  return genericSpeakerNumber(name) !== null
}

function speakerKey(name: string): string {
  return normalizeForSearch(name).replace(/\s+/g, ' ').trim()
}

function tokensOf(text: string): string[] {
  return normalizeForSearch(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '')
}

/** Semelhança entre dois textos (0 a 1): palavras em comum sobre palavras no total. */
export function textSimilarity(a: string, b: string): number {
  const left = new Set(tokensOf(a))
  const right = new Set(tokensOf(b))
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared++
  return shared / (left.size + right.size - shared)
}

export function toAbsolute(plan: ChunkPlan, utterances: readonly RawUtterance[]): TimedUtterance[] {
  return utterances.map((u) => ({ ...u, startMs: u.startMs + plan.startMs }))
}

/**
 * Descobre, na sobreposição entre dois blocos, quem é quem: cada Fala do bloco novo é casada
 * (por Instante próximo e texto parecido) com a Fala do trecho já montado, e os rótulos votam
 * por peso (nº de palavras). Devolve `rótulo do bloco -> rótulo da Transcrição`.
 */
export function voteSpeakers(
  existing: readonly TimedUtterance[],
  incoming: readonly TimedUtterance[]
): Map<string, string> {
  const votes = new Map<string, Map<string, number>>()
  for (const candidate of incoming) {
    const weight = tokensOf(candidate.text).length
    if (weight < 2) continue
    let best: TimedUtterance | null = null
    let bestScore = MIN_MATCH_SIMILARITY
    for (const other of existing) {
      if (Math.abs(other.startMs - candidate.startMs) > MATCH_WINDOW_MS) continue
      const score = textSimilarity(candidate.text, other.text)
      if (score >= bestScore) {
        best = other
        bestScore = score
      }
    }
    if (!best) continue
    const forLabel = votes.get(candidate.speaker) ?? new Map<string, number>()
    forLabel.set(best.speaker, (forLabel.get(best.speaker) ?? 0) + weight)
    votes.set(candidate.speaker, forLabel)
  }
  const winners: { label: string; target: string; weight: number }[] = []
  for (const [label, forLabel] of votes) {
    let target: string | null = null
    let weight = 0
    for (const [candidate, candidateWeight] of forLabel) {
      if (candidateWeight > weight) {
        target = candidate
        weight = candidateWeight
      }
    }
    if (target !== null && weight >= MIN_VOTE_WEIGHT) winners.push({ label, target, weight })
  }
  // Duas vozes distintas do mesmo bloco nunca são a mesma pessoa: se dois rótulos apontam para o
  // mesmo Falante, só o de maior peso fica; o outro segue sem correspondência em vez de se fundir.
  const strongest = new Map<string, number>()
  for (const { target, weight } of winners) {
    strongest.set(target, Math.max(strongest.get(target) ?? 0, weight))
  }
  const mapping = new Map<string, string>()
  for (const { label, target, weight } of winners) {
    if (weight === strongest.get(target) && !mapping.has(label)) mapping.set(label, target)
  }
  const claimed = new Set<string>()
  for (const [label, target] of mapping) {
    if (claimed.has(target)) mapping.delete(label)
    claimed.add(target)
  }
  return mapping
}

function mergeNext(
  merged: TimedUtterance[],
  previous: ChunkPlan,
  next: ChunkResult,
  log: (message: string) => void
): TimedUtterance[] {
  const { plan } = next
  const incoming = toAbsolute(plan, next.utterances)
  const overlapFrom = plan.startMs - MATCH_WINDOW_MS / 2
  const overlapTo = previous.endMs + MATCH_WINDOW_MS / 2

  const mapping = voteSpeakers(
    merged.filter((u) => u.startMs >= overlapFrom && u.startMs <= overlapTo),
    incoming.filter((u) => u.startMs <= overlapTo)
  )

  const known = new Map<string, string>()
  for (const u of merged) known.set(speakerKey(u.speaker), u.speaker)

  // Um Falante genérico ("Falante 2") que o bloco novo identificou pelo nome passa a ter esse nome.
  const renames = new Map<string, string>()
  const resolve = (label: string): string => {
    const mapped = mapping.get(label)
    if (mapped !== undefined) {
      if (!isGenericSpeaker(label) && isGenericSpeaker(mapped) && !known.has(speakerKey(label))) {
        renames.set(mapped, label)
      }
      return mapped
    }
    const same = known.get(speakerKey(label)) ?? label
    if (!claimed.has(same)) return same
    // Outra voz do bloco já ficou com esse Falante: esta é uma pessoa diferente.
    return `Falante ${nextGeneric++}`
  }
  const claimed = new Set(mapping.values())
  let nextGeneric =
    1 + Math.max(0, ...[...known.values()].map((name) => genericSpeakerNumber(name) ?? 0))
  const resolved = new Map<string, string>()
  for (const u of incoming)
    if (!resolved.has(u.speaker)) resolved.set(u.speaker, resolve(u.speaker))
  const finalName = (name: string): string => renames.get(name) ?? name

  // Sem evidência na sobreposição não há fusão; o log só ajuda a investigar Falantes duplicados.
  const created = [...new Set(resolved.values())].filter(
    (label) => isGenericSpeaker(label) && !known.has(speakerKey(label))
  )
  if (created.length > 0) {
    const used = new Set(resolved.values())
    const absent = [
      ...new Set(
        merged
          .filter((u) => u.startMs >= previous.startMs && isGenericSpeaker(u.speaker))
          .map((u) => u.speaker)
      )
    ].filter((label) => !used.has(label))
    if (absent.length === 1) {
      log(
        `[transcrição] bloco ${next.plan.index + 1}: ${created.join(', ')} sem correspondência; ` +
          `único Falante sem nome do bloco anterior ausente neste: ${absent[0]} (não fundido)`
      )
    }
  }

  const seam = plan.ownFromMs
  const kept = merged
    .filter((u) => u.startMs < seam)
    .map((u) => ({ ...u, speaker: finalName(u.speaker) }))
  const tail = kept.filter((u) => u.startMs >= seam - SEAM_DUPLICATE_WINDOW_MS)
  const added = incoming
    .filter((u) => u.startMs >= seam)
    .map((u) => ({ ...u, speaker: finalName(resolved.get(u.speaker) ?? u.speaker) }))
    .filter(
      (u) =>
        !(
          u.startMs <= seam + SEAM_DUPLICATE_WINDOW_MS &&
          tail.some((t) => textSimilarity(t.text, u.text) >= SEAM_DUPLICATE_SIMILARITY)
        )
    )
  return [...kept, ...added]
}

/**
 * Junta os blocos (em ordem) numa só lista de Falas com Instantes da Reunião: ajusta o offset de
 * cada bloco, une os Falantes pelo que se repete na sobreposição e emenda sem duplicar.
 */
export function mergeChunks(
  results: readonly ChunkResult[],
  log: (message: string) => void = () => undefined
): TimedUtterance[] {
  const [first, ...rest] = results
  if (!first) return []
  let merged = toAbsolute(first.plan, first.utterances)
  let previous = first.plan
  for (const next of rest) {
    merged = mergeNext(merged, previous, next, log)
    previous = next.plan
  }
  return merged
}

const GHOST_MAX_UTTERANCES = 2
const GHOST_MAX_SHARE = 0.01
const MAX_SPEAKING_MS = 30_000
const MIN_UTTERANCES_TO_JUDGE = 20

/**
 * Falantes sem nome com no máximo 2 Falas e menos de 1% do tempo de fala são ruído da IA (uma
 * voz "inventada" num trecho): suas Falas passam para o Falante da Fala anterior (ou da seguinte,
 * se for a primeira).
 */
export function mergeGhostSpeakers(sorted: readonly TimedUtterance[]): TimedUtterance[] {
  // Com poucas Falas não dá para julgar o que é ruído.
  if (sorted.length < MIN_UTTERANCES_TO_JUDGE) return [...sorted]
  const stats = new Map<string, { count: number; ms: number }>()
  let total = 0
  sorted.forEach((u, index) => {
    const end = sorted[index + 1]?.startMs ?? u.startMs
    const ms = Math.min(Math.max(end - u.startMs, 0), MAX_SPEAKING_MS)
    const stat = stats.get(u.speaker) ?? { count: 0, ms: 0 }
    stat.count += 1
    stat.ms += ms
    stats.set(u.speaker, stat)
    total += ms
  })
  const ghosts = new Set(
    [...stats]
      .filter(
        ([label, stat]) =>
          isGenericSpeaker(label) &&
          stat.count <= GHOST_MAX_UTTERANCES &&
          stat.ms < total * GHOST_MAX_SHARE
      )
      .map(([label]) => label)
  )
  // Sem nenhum Falante de verdade, não há para onde fundir.
  if (ghosts.size === 0 || ghosts.size === stats.size) return [...sorted]

  const result: TimedUtterance[] = []
  sorted.forEach((u, index) => {
    if (!ghosts.has(u.speaker)) {
      result.push(u)
      return
    }
    const next = sorted.slice(index + 1).find((candidate) => !ghosts.has(candidate.speaker))
    const target = result[result.length - 1]?.speaker ?? next?.speaker ?? u.speaker
    result.push({ ...u, speaker: target })
  })
  return result
}

/** "Falante 7, 2, 9" por ordem de aparição viram "Falante 1, 2, 3"; nomes ficam como estão. */
function renumberGeneric(sorted: readonly TimedUtterance[]): TimedUtterance[] {
  const numbers = new Map<string, string>()
  for (const u of sorted) {
    if (isGenericSpeaker(u.speaker) && !numbers.has(u.speaker)) {
      numbers.set(u.speaker, `Falante ${numbers.size + 1}`)
    }
  }
  return sorted.map((u) => ({ ...u, speaker: numbers.get(u.speaker) ?? u.speaker }))
}

/**
 * Ordena, funde Falantes fantasmas, renumera os "Falante N" em sequência, remove repetições
 * coladas e numera as Falas; os Falantes seguem a ordem de aparição.
 */
export function finalizeUtterances(timed: readonly TimedUtterance[]): {
  speakers: Speaker[]
  utterances: Utterance[]
} {
  const sorted = [...timed].sort((a, b) => a.startMs - b.startMs)
  const kept: TimedUtterance[] = []
  for (const u of renumberGeneric(mergeGhostSpeakers(sorted))) {
    const last = kept[kept.length - 1]
    if (last && last.speaker === u.speaker && last.text === u.text) continue
    kept.push(u)
  }
  const labels = kept.map((u) => u.speaker)
  const speakers = assignSpeakers(labels)
  const idByLabel = new Map(
    [...new Set(labels)].map((label, index) => [label, (speakers[index] as Speaker).id])
  )
  return {
    speakers,
    utterances: kept.map((u, index) => ({
      id: `u${index + 1}`,
      speakerId: idByLabel.get(u.speaker) as string,
      startMs: u.startMs,
      text: u.text
    }))
  }
}

/** Falantes já identificados num conjunto de blocos (para o prompt dos blocos seguintes). */
export function speakersOf(results: readonly ChunkResult[]): string[] {
  const names: string[] = []
  for (const result of results) {
    for (const u of result.utterances) if (!names.includes(u.speaker)) names.push(u.speaker)
  }
  return names
}
