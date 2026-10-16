import { isQualityPreset, type QualityPreset } from './capture'
import { parseSummaryMeta, type SummaryMeta } from './summary'
import { parseTranscriptMeta, type TranscriptMeta } from './transcript'

/**
 * `meeting.json`: o registro de uma Reunião dentro da sua pasta (ADR 0005 — a pasta é a
 * fonte da verdade). Versionado por `schemaVersion`; validado sempre que lido.
 */
export const MEETING_SCHEMA_VERSION = 1
export const MEETING_FILE = 'meeting.json'
/** Nomes dos arquivos da pasta da Reunião. */
export const MEETING_FILES = {
  video: 'video.mp4',
  audio: 'audio.opus',
  /** Pedaços gravados ao vivo; viram `video.mp4` / `audio.opus` no pós-gravação. */
  videoPart: 'video.part.mp4',
  audioPart: 'audio.part.webm'
} as const

/**
 * Situação da Reunião no ciclo de gravação:
 * - `recording`: gravando — ou interrompida (crash), se o app não está gravando;
 * - `processing`: gravação encerrada, pós-processamento (FFmpeg) em andamento;
 * - `unprocessed`: encerrada, mas o pós-processamento não concluiu (FFmpeg ausente ou falhou);
 *   os pedaços ficam guardados e a recuperação tenta de novo;
 * - `ready`: `video.mp4` e `audio.opus` finais, íntegros.
 */
export const MEETING_STATUSES = ['recording', 'processing', 'unprocessed', 'ready'] as const
export type MeetingStatus = (typeof MEETING_STATUSES)[number]

/** Estados em que a pasta ainda tem trabalho pendente (a recuperação cuida deles). */
export function needsRecovery(status: MeetingStatus): boolean {
  return status !== 'ready'
}

export const CAPTURE_SOURCE_KINDS = ['screen', 'window', 'none'] as const
/** Tipo da Fonte de captura: tela, janela ou nenhuma (Reunião só de áudio). */
export type CaptureSourceKind = (typeof CAPTURE_SOURCE_KINDS)[number]

/** Anotação (Note): texto do usuário preso a um Instante. Preenchida a partir da Fase 3. */
export interface MeetingNote {
  id: string
  /** Instante em ms, contado sem os períodos pausados. */
  offsetMs: number
  text: string
  createdAt: string
}

/** Ocorrência durante a gravação que o usuário talvez precise saber (ex.: o vídeo parou de ser gravado). */
export interface MeetingIssue {
  code: 'video-encoder-stalled'
  /** Instante (ms de gravação) em que foi detectada. */
  atMs: number
}

export const MEETING_ISSUE_CODES = ['video-encoder-stalled'] as const

export interface MeetingVideoInfo {
  file: string
  width: number
  height: number
  fps: number
}

export interface MeetingFile {
  schemaVersion: typeof MEETING_SCHEMA_VERSION
  id: string
  name: string
  /** ISO 8601 (UTC): início da gravação. */
  createdAt: string
  endedAt: string | null
  /** Duração gravada (sem pausas); `null` até a gravação terminar. */
  durationMs: number | null
  status: MeetingStatus
  source: { kind: CaptureSourceKind; name: string | null }
  quality: QualityPreset
  /** Vídeo esperado/final; `null` na Reunião só de áudio (ou se nenhum quadro foi gravado). */
  video: MeetingVideoInfo | null
  audio: { file: string } | null
  inputs: { mic: boolean; systemAudio: boolean }
  notes: MeetingNote[]
  /** Ocorrências da gravação; vazio quando tudo correu bem. */
  issues: MeetingIssue[]
  /** Estado da Transcrição; as Falas ficam em `transcript.json`, na mesma pasta. */
  transcript?: TranscriptMeta
  /** Estado do Resumo; o conteúdo fica em `summary.json`, e a Conversa em `chat.json`. */
  summary?: SummaryMeta
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

/** Um nome de arquivo simples (sem diretório): o `meeting.json` nunca aponta para fora da pasta. */
function isPlainFileName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\\/]/.test(value) && value !== '..'
}

function parseNotes(value: unknown): MeetingNote[] | string {
  if (!Array.isArray(value)) return 'notes: esperado uma lista'
  const notes: MeetingNote[] = []
  for (const [index, item] of value.entries()) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !isFiniteNumber(item.offsetMs) ||
      item.offsetMs < 0 ||
      typeof item.text !== 'string' ||
      !isIsoDate(item.createdAt)
    ) {
      return `notes[${index}]: Anotação inválida`
    }
    notes.push({
      id: item.id,
      offsetMs: item.offsetMs,
      text: item.text,
      createdAt: item.createdAt
    })
  }
  return notes
}

function parseIssues(value: unknown): MeetingIssue[] | string {
  if (value === undefined) return []
  if (!Array.isArray(value)) return 'issues: esperado uma lista'
  const issues: MeetingIssue[] = []
  for (const [index, item] of value.entries()) {
    if (
      !isRecord(item) ||
      !(MEETING_ISSUE_CODES as readonly unknown[]).includes(item.code) ||
      !isFiniteNumber(item.atMs) ||
      item.atMs < 0
    ) {
      return `issues[${index}]: ocorrência inválida`
    }
    issues.push({ code: item.code as MeetingIssue['code'], atMs: item.atMs })
  }
  return issues
}

function parseVideo(value: unknown): MeetingVideoInfo | null | string {
  if (value === null) return null
  if (
    !isRecord(value) ||
    !isPlainFileName(value.file) ||
    !isFiniteNumber(value.width) ||
    !isFiniteNumber(value.height) ||
    !isFiniteNumber(value.fps) ||
    value.width <= 0 ||
    value.height <= 0
  ) {
    return 'video: esperado null ou { file, width, height, fps }'
  }
  return { file: value.file, width: value.width, height: value.height, fps: value.fps }
}

/** Valida o conteúdo lido de um `meeting.json`. Nunca lança. */
export function parseMeeting(raw: unknown): ParseResult<MeetingFile> {
  if (!isRecord(raw)) return { ok: false, error: 'meeting.json não é um objeto' }

  if (raw.schemaVersion !== MEETING_SCHEMA_VERSION) {
    const version = isFiniteNumber(raw.schemaVersion) ? String(raw.schemaVersion) : 'ausente'
    return {
      ok: false,
      error: `schemaVersion ${version} não suportado (esperado ${MEETING_SCHEMA_VERSION})`
    }
  }
  if (typeof raw.id !== 'string' || raw.id.length === 0) return { ok: false, error: 'id inválido' }
  if (typeof raw.name !== 'string') return { ok: false, error: 'name inválido' }
  if (!isIsoDate(raw.createdAt)) return { ok: false, error: 'createdAt inválido' }
  if (raw.endedAt !== null && !isIsoDate(raw.endedAt)) {
    return { ok: false, error: 'endedAt inválido' }
  }
  if (raw.durationMs !== null && !(isFiniteNumber(raw.durationMs) && raw.durationMs >= 0)) {
    return { ok: false, error: 'durationMs inválido' }
  }
  if (
    typeof raw.status !== 'string' ||
    !(MEETING_STATUSES as readonly string[]).includes(raw.status)
  ) {
    return { ok: false, error: 'status inválido' }
  }
  const status = raw.status as MeetingStatus

  const source = raw.source
  if (
    !isRecord(source) ||
    typeof source.kind !== 'string' ||
    !(CAPTURE_SOURCE_KINDS as readonly string[]).includes(source.kind) ||
    (source.name !== null && typeof source.name !== 'string')
  ) {
    return { ok: false, error: 'source inválido' }
  }

  if (!isQualityPreset(raw.quality)) return { ok: false, error: 'quality inválido' }

  const video = parseVideo(raw.video)
  if (typeof video === 'string') return { ok: false, error: video }

  let audio: MeetingFile['audio'] = null
  if (raw.audio !== null) {
    if (!isRecord(raw.audio) || !isPlainFileName(raw.audio.file)) {
      return { ok: false, error: 'audio: esperado null ou { file }' }
    }
    audio = { file: raw.audio.file }
  }

  const inputs = raw.inputs
  if (!isRecord(inputs) || typeof inputs.mic !== 'boolean') {
    return { ok: false, error: 'inputs inválido' }
  }
  if (typeof inputs.systemAudio !== 'boolean') return { ok: false, error: 'inputs inválido' }

  const notes = parseNotes(raw.notes)
  if (typeof notes === 'string') return { ok: false, error: notes }

  const issues = parseIssues(raw.issues)
  if (typeof issues === 'string') return { ok: false, error: issues }

  const meeting: MeetingFile = {
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    endedAt: raw.endedAt,
    durationMs: raw.durationMs,
    status,
    source: { kind: source.kind as CaptureSourceKind, name: source.name },
    quality: raw.quality,
    video,
    audio,
    inputs: { mic: inputs.mic, systemAudio: inputs.systemAudio },
    notes,
    issues
  }
  const transcript = parseTranscriptMeta(raw.transcript)
  if (transcript) meeting.transcript = transcript
  const summary = parseSummaryMeta(raw.summary)
  if (summary) meeting.summary = summary
  return { ok: true, value: meeting }
}

/** Texto do `meeting.json` (indentado, com quebra de linha final). */
export function serializeMeeting(meeting: MeetingFile): string {
  return `${JSON.stringify(meeting, null, 2)}\n`
}

/** Lê o texto de um `meeting.json`. Nunca lança. */
export function parseMeetingText(text: string): ParseResult<MeetingFile> {
  let raw: unknown
  try {
    // Remove o BOM, que editores do Windows costumam gravar.
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return { ok: false, error: 'meeting.json não é um JSON válido' }
  }
  return parseMeeting(raw)
}
