import type { ParseResult } from './meeting'

export const TRANSCRIPT_FILE = 'transcript.json'
/** Blocos já transcritos de uma Transcrição em andamento ou interrompida (some ao concluir). */
export const TRANSCRIPT_PARTIAL_FILE = 'transcript.partial.json'
/** Versão gravada. A 1 (o rótulo do Falante em cada Fala) ainda é lida e convertida. */
export const TRANSCRIPT_SCHEMA_VERSION = 2

/**
 * Situação da Transcrição no `meeting.json`:
 * - `none`: nunca gerada (ou cancelada);
 * - `running`: em andamento no main (se o app fechou no meio, ao reabrir vira `error`);
 * - `ready`: `transcript.json` pronto;
 * - `error`: falhou ou foi interrompida; dá para tentar de novo aproveitando os blocos prontos.
 */
export const TRANSCRIPT_STATUSES = ['none', 'running', 'ready', 'error'] as const
export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number]

export interface TranscriptMeta {
  status: TranscriptStatus
  error?: string
  model: string
  updatedAt: string
  /** O usuário escolheu "Transcrever + resumir": o Resumo é gerado quando a Transcrição ficar pronta. */
  summaryRequested?: boolean
}

/**
 * Falante (Speaker): `name` é o nome dito na conversa ou dado pelo usuário; `null` mostra
 * "Falante N", com N tirado do `id` (`s2` vira "Falante 2").
 */
export interface Speaker {
  id: string
  name: string | null
}

/** Fala (Utterance): trecho contínuo de um Falante, com o Instante em que começa. */
export interface Utterance {
  id: string
  speakerId: string
  startMs: number
  text: string
}

export interface TranscriptFile {
  schemaVersion: typeof TRANSCRIPT_SCHEMA_VERSION
  model: string
  createdAt: string
  durationMs: number | null
  /** Falantes na ordem em que aparecem. */
  speakers: Speaker[]
  /** Ordenadas por Instante. */
  utterances: Utterance[]
}

export interface TranscriptProgress {
  done: number
  total: number
}

/** O que a UI vê da Transcrição de uma Reunião: o `meeting.json` mais o progresso em memória. */
export interface TranscriptView {
  status: TranscriptStatus
  error: string | null
  model: string | null
  updatedAt: string | null
  summaryRequested: boolean
  done: number
  total: number
}

export const NO_TRANSCRIPT: TranscriptView = {
  status: 'none',
  error: null,
  model: null,
  updatedAt: null,
  summaryRequested: false,
  done: 0,
  total: 0
}

export function makeTranscriptView(
  meta: TranscriptMeta | undefined,
  progress: TranscriptProgress | null
): TranscriptView {
  if (!meta) return NO_TRANSCRIPT
  return {
    status: meta.status,
    error: meta.error ?? null,
    model: meta.model,
    updatedAt: meta.updatedAt,
    summaryRequested: meta.summaryRequested === true,
    done: progress?.done ?? 0,
    total: progress?.total ?? 0
  }
}

/** Evento enviado à UI a cada mudança de estado ou de progresso de uma Transcrição. */
export interface TranscriptChangedEvent {
  meetingId: string
  folder: string
  view: TranscriptView
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

/** Lê o bloco `transcript` do `meeting.json`; formato inválido = `undefined` (como se não existisse). */
export function parseTranscriptMeta(raw: unknown): TranscriptMeta | undefined {
  if (!isRecord(raw)) return undefined
  if (
    typeof raw.status !== 'string' ||
    !(TRANSCRIPT_STATUSES as readonly string[]).includes(raw.status) ||
    typeof raw.model !== 'string' ||
    !isIsoDate(raw.updatedAt)
  ) {
    return undefined
  }
  const meta: TranscriptMeta = {
    status: raw.status as TranscriptStatus,
    model: raw.model,
    updatedAt: raw.updatedAt
  }
  if (typeof raw.error === 'string' && raw.error !== '') meta.error = raw.error
  if (raw.summaryRequested === true) meta.summaryRequested = true
  return meta
}

/** "Falante 3" vira 3; qualquer outro texto, `null`. */
export function genericSpeakerNumber(label: string): number | null {
  const match = /^Falante (\d+)$/.exec(label)
  return match ? Number(match[1]) : null
}

/**
 * Dá um `id` a cada rótulo (sem repetir, na ordem): "Falante N" vira `sN` sem nome; um nome
 * próprio pega o menor número livre.
 */
export function assignSpeakers(labels: readonly string[]): Speaker[] {
  const unique = [...new Set(labels)]
  const taken = new Set<number>()
  for (const label of unique) {
    const number = genericSpeakerNumber(label)
    if (number !== null) taken.add(number)
  }
  return unique.map((label) => {
    const number = genericSpeakerNumber(label)
    if (number !== null) return { id: `s${number}`, name: null }
    let free = 1
    while (taken.has(free)) free++
    taken.add(free)
    return { id: `s${free}`, name: label }
  })
}

/** Como o Falante aparece na UI: o nome, ou "Falante N". */
export function speakerLabel(speaker: Speaker): string {
  if (speaker.name) return speaker.name
  const digits = /\d+/.exec(speaker.id)
  return digits ? `Falante ${Number(digits[0])}` : 'Falante'
}

/** Rótulo do Falante `id` numa lista de Falantes. */
export function labelFor(speakers: readonly Speaker[], id: string): string {
  const speaker = speakers.find((candidate) => candidate.id === id)
  return speaker ? speakerLabel(speaker) : 'Falante'
}

const MAX_SPEAKER_NAME_LENGTH = 60

/** Renomeia um Falante. Nome vazio volta ao "Falante N". Dois Falantes não podem ficar com o mesmo rótulo. */
export function renameSpeaker(
  speakers: readonly Speaker[],
  id: string,
  rawName: string
): { ok: true; speakers: Speaker[] } | { ok: false; error: string } {
  if (!speakers.some((speaker) => speaker.id === id)) {
    return { ok: false, error: 'O Falante não existe mais.' }
  }
  const name = rawName.replace(/\s+/g, ' ').trim().slice(0, MAX_SPEAKER_NAME_LENGTH)
  const next = speakers.map((speaker) =>
    speaker.id === id ? { ...speaker, name: name === '' ? null : name } : speaker
  )
  const label = normalizeForSearch(labelFor(next, id))
  const clash = next.some(
    (speaker) => speaker.id !== id && normalizeForSearch(speakerLabel(speaker)) === label
  )
  return clash
    ? { ok: false, error: 'Já existe outro Falante com esse nome.' }
    : { ok: true, speakers: next }
}

export interface SpeakerStat {
  id: string
  utterances: number
  /** Tempo de fala estimado: da Fala até a próxima (no máximo `MAX_UTTERANCE_MS` cada). */
  speakingMs: number
}

const MAX_UTTERANCE_MS = 30_000

export function speakerStats(
  speakers: readonly Speaker[],
  utterances: readonly Utterance[],
  durationMs: number | null
): SpeakerStat[] {
  const stats = new Map<string, SpeakerStat>(
    speakers.map((speaker) => [speaker.id, { id: speaker.id, utterances: 0, speakingMs: 0 }])
  )
  utterances.forEach((utterance, index) => {
    const stat = stats.get(utterance.speakerId)
    if (!stat) return
    const end = utterances[index + 1]?.startMs ?? durationMs ?? utterance.startMs
    stat.utterances += 1
    stat.speakingMs += Math.min(Math.max(end - utterance.startMs, 0), MAX_UTTERANCE_MS)
  })
  return [...stats.values()]
}

function parseUtterance(item: unknown): Omit<Utterance, 'speakerId'> | null {
  if (
    !isRecord(item) ||
    typeof item.id !== 'string' ||
    typeof item.text !== 'string' ||
    typeof item.startMs !== 'number' ||
    !Number.isFinite(item.startMs) ||
    item.startMs < 0
  ) {
    return null
  }
  return { id: item.id, startMs: item.startMs, text: item.text }
}

function parseSpeakers(raw: unknown): Speaker[] | null {
  if (!Array.isArray(raw)) return null
  const speakers: Speaker[] = []
  for (const item of raw) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      item.id === '' ||
      (item.name !== null && typeof item.name !== 'string')
    ) {
      return null
    }
    speakers.push({ id: item.id, name: item.name === '' ? null : item.name })
  }
  return new Set(speakers.map((speaker) => speaker.id)).size === speakers.length ? speakers : null
}

export function parseTranscript(raw: unknown): ParseResult<TranscriptFile> {
  if (!isRecord(raw)) return { ok: false, error: 'transcript.json não é um objeto' }
  if (raw.schemaVersion !== TRANSCRIPT_SCHEMA_VERSION && raw.schemaVersion !== 1) {
    return { ok: false, error: 'versão do transcript.json não suportada' }
  }
  if (typeof raw.model !== 'string') return { ok: false, error: 'model inválido' }
  if (!isIsoDate(raw.createdAt)) return { ok: false, error: 'createdAt inválido' }
  const durationMs =
    typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs) && raw.durationMs >= 0
      ? raw.durationMs
      : null
  if (!Array.isArray(raw.utterances)) return { ok: false, error: 'utterances inválido' }

  let speakers: Speaker[]
  const utterances: Utterance[] = []
  if (raw.schemaVersion === 1) {
    const items: { base: Omit<Utterance, 'speakerId'>; label: string }[] = []
    for (const [index, item] of raw.utterances.entries()) {
      const base = parseUtterance(item)
      const label = isRecord(item) ? item.speaker : undefined
      if (!base || typeof label !== 'string' || label === '') {
        return { ok: false, error: `utterances[${index}]: Fala inválida` }
      }
      items.push({ base, label })
    }
    const labels = items.map((item) => item.label)
    speakers = assignSpeakers(labels)
    const idByLabel = new Map(
      [...new Set(labels)].map((label, index) => [label, (speakers[index] as Speaker).id])
    )
    for (const { base, label } of items) {
      utterances.push({ ...base, speakerId: idByLabel.get(label) as string })
    }
  } else {
    const parsed = parseSpeakers(raw.speakers)
    if (!parsed) return { ok: false, error: 'speakers inválido' }
    speakers = parsed
    for (const [index, item] of raw.utterances.entries()) {
      const base = parseUtterance(item)
      const speakerId = isRecord(item) ? item.speakerId : undefined
      if (!base || typeof speakerId !== 'string' || !speakers.some((s) => s.id === speakerId)) {
        return { ok: false, error: `utterances[${index}]: Fala inválida` }
      }
      utterances.push({ ...base, speakerId })
    }
  }
  return {
    ok: true,
    value: {
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      model: raw.model,
      createdAt: raw.createdAt,
      durationMs,
      speakers,
      utterances
    }
  }
}

export function parseTranscriptText(text: string): ParseResult<TranscriptFile> {
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return { ok: false, error: 'transcript.json não é um JSON válido' }
  }
  return parseTranscript(raw)
}

export function serializeTranscript(transcript: TranscriptFile): string {
  return `${JSON.stringify(transcript, null, 2)}\n`
}

/**
 * Fala "atual" no Instante `ms`: a última que já começou. `-1` antes da primeira.
 * Exige as Falas ordenadas por Instante (busca binária).
 */
export function currentUtteranceIndex(utterances: readonly Utterance[], ms: number): number {
  let low = 0
  let high = utterances.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if ((utterances[mid] as Utterance).startMs <= ms) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

/** Quantas cores de Falante existem em `tokens.css` (`--speaker-1` ... `--speaker-N`). */
export const SPEAKER_COLOR_COUNT = 8

/** Cor estável do Falante: pela ordem em que aparece na Transcrição. */
export function speakerColorIndex(speakers: readonly Speaker[], id: string): number {
  const index = speakers.findIndex((speaker) => speaker.id === id)
  return (index < 0 ? 0 : index) % SPEAKER_COLOR_COUNT
}

/** Minúsculas e sem acentos, para buscar e comparar nomes. */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Trechos de `text` que casam com `query`, ignorando maiúsculas e acentos, como pares
 * `[início, fim)` no texto original. Busca vazia = nenhum trecho.
 */
export function findMatches(text: string, query: string): [number, number][] {
  const needle = normalizeForSearch(query).trim()
  if (needle === '') return []
  let haystack = ''
  const origin: number[] = []
  for (let i = 0; i < text.length; i++) {
    const normalized = normalizeForSearch(text.charAt(i))
    for (let k = 0; k < normalized.length; k++) origin.push(i)
    haystack += normalized
  }
  const matches: [number, number][] = []
  for (
    let at = haystack.indexOf(needle);
    at >= 0;
    at = haystack.indexOf(needle, at + needle.length)
  ) {
    const start = origin[at] as number
    const end = (origin[at + needle.length - 1] as number) + 1
    matches.push([start, end])
  }
  return matches
}
