import {
  DEFAULT_GEMINI_TEXT_MODEL,
  DEFAULT_GROQ_TEXT_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
  isGeminiTextModel,
  isGroqTextModel,
  isTranscriptionModel
} from './ai'
import { DEFAULT_QUALITY, isQualityPreset, type QualityPreset } from './capture'
import { DEFAULT_COMPACTION_MODE, isCompactionMode, type CompactionMode } from './compaction'
import type { Point } from './floating'
import { DEFAULT_NOTE_LEAD_SECONDS, DEFAULT_NOTE_SHORTCUT, MAX_NOTE_LEAD_SECONDS } from './notes'
import { normalizeAccelerator } from './shortcut'
import { DEFAULT_THEME, isThemePreference, type ThemePreference } from './theme'

/** Codificador do Vídeo ao vivo: software (padrão) ou hardware (NVENC/QSV/AMF via Media Foundation). */
export const VIDEO_ENCODERS = ['software', 'hardware'] as const
export type VideoEncoder = (typeof VIDEO_ENCODERS)[number]

export function isVideoEncoder(value: unknown): value is VideoEncoder {
  return typeof value === 'string' && (VIDEO_ENCODERS as readonly string[]).includes(value)
}

/** Configurações persistidas em `userData/settings.json`. */
export interface AppSettings {
  /** Pasta das Reuniões; `null` = `Documentos\ClearMeet`. */
  meetingsDir: string | null
  /** Compactação ligada (padrão): define o bitrate ao vivo e se o Vídeo é recomprimido depois. */
  compaction: boolean
  /** Velocidade (padrão) ou qualidade máxima na Compactação. */
  compactionMode: CompactionMode
  quality: QualityPreset
  /**
   * Codificador H.264 do Vídeo ao vivo. É uma opção de processo do Chromium: o main a lê do
   * `settings.json` ao iniciar e só vale depois de reiniciar o app; não aparece na UI. Padrão:
   * `software`, porque o codificador por hardware travava de forma intermitente.
   */
  videoEncoder: VideoEncoder
  /** Último microfone escolhido; `null` = padrão do sistema; `'none'` = gravar sem microfone. */
  micDeviceId: string | null
  /** Grava também o áudio que toca no computador (loopback); ligado por padrão. */
  systemAudio: boolean
  /**
   * Atalho global que abre o campo de Anotação durante a gravação (formato de acelerador do
   * Electron). Só vale ao iniciar a gravação.
   */
  noteShortcut: string
  /** Quantos segundos o Instante de uma Anotação ao vivo recua em relação à primeira tecla. */
  noteLeadSeconds: number
  /** Última posição da barra flutuante (DIP); `null` = topo-centro do monitor principal. */
  barPosition: Point | null
  /** Modelo do Gemini que gera a Transcrição. */
  transcriptionModel: string
  /** Modelo da Groq para o Resumo e a Conversa (usado quando há chave da Groq). */
  groqTextModel: string
  /** Modelo do Gemini para o Resumo e a Conversa (sem chave da Groq, ou como reserva). */
  geminiTextModel: string
  /** Tema da interface: acompanha o Windows (padrão), claro ou escuro. */
  theme: ThemePreference
  /** A configuração inicial (FFmpeg, pasta, chaves) já foi feita ou dispensada. */
  setupCompleted: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  meetingsDir: null,
  compaction: true,
  compactionMode: DEFAULT_COMPACTION_MODE,
  quality: DEFAULT_QUALITY,
  videoEncoder: 'software',
  micDeviceId: null,
  systemAudio: true,
  noteShortcut: DEFAULT_NOTE_SHORTCUT,
  noteLeadSeconds: DEFAULT_NOTE_LEAD_SECONDS,
  barPosition: null,
  transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
  groqTextModel: DEFAULT_GROQ_TEXT_MODEL,
  geminiTextModel: DEFAULT_GEMINI_TEXT_MODEL,
  theme: DEFAULT_THEME,
  setupCompleted: false
}

export const SETTINGS_SCHEMA_VERSION = 1

/** Configurações vistas pela UI: as gravadas mais a pasta efetiva das Reuniões. */
export interface SettingsView extends AppSettings {
  resolvedMeetingsDir: string
}

/** O que a UI pode alterar (a pasta das Reuniões tem canal próprio). */
export type SettingsPatch = Partial<
  Pick<
    AppSettings,
    | 'quality'
    | 'compaction'
    | 'compactionMode'
    | 'micDeviceId'
    | 'systemAudio'
    | 'transcriptionModel'
    | 'groqTextModel'
    | 'geminiTextModel'
    | 'noteShortcut'
    | 'noteLeadSeconds'
    | 'theme'
    | 'setupCompleted'
  >
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validLeadSeconds(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_NOTE_LEAD_SECONDS
  )
}

function parseBarPosition(value: unknown): Point | null {
  if (!isRecord(value)) return null
  const { x, y } = value
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: Math.round(x), y: Math.round(y) }
}

/**
 * Valida o conteúdo de `settings.json` campo a campo: um campo inválido volta ao padrão
 * sem perder os demais. Qualquer coisa que não seja objeto devolve os padrões.
 */
export function parseSettings(raw: unknown): AppSettings {
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS }
  const meetingsDir =
    typeof raw.meetingsDir === 'string' && raw.meetingsDir.trim() !== ''
      ? raw.meetingsDir
      : DEFAULT_SETTINGS.meetingsDir
  const micDeviceId =
    typeof raw.micDeviceId === 'string' && raw.micDeviceId !== ''
      ? raw.micDeviceId
      : DEFAULT_SETTINGS.micDeviceId
  return {
    meetingsDir,
    compaction: typeof raw.compaction === 'boolean' ? raw.compaction : DEFAULT_SETTINGS.compaction,
    compactionMode: isCompactionMode(raw.compactionMode)
      ? raw.compactionMode
      : DEFAULT_SETTINGS.compactionMode,
    quality: isQualityPreset(raw.quality) ? raw.quality : DEFAULT_SETTINGS.quality,
    videoEncoder: isVideoEncoder(raw.videoEncoder)
      ? raw.videoEncoder
      : DEFAULT_SETTINGS.videoEncoder,
    micDeviceId,
    systemAudio:
      typeof raw.systemAudio === 'boolean' ? raw.systemAudio : DEFAULT_SETTINGS.systemAudio,
    noteShortcut: normalizeAccelerator(raw.noteShortcut) ?? DEFAULT_SETTINGS.noteShortcut,
    noteLeadSeconds: validLeadSeconds(raw.noteLeadSeconds)
      ? raw.noteLeadSeconds
      : DEFAULT_SETTINGS.noteLeadSeconds,
    barPosition: parseBarPosition(raw.barPosition),
    transcriptionModel: isTranscriptionModel(raw.transcriptionModel)
      ? raw.transcriptionModel
      : DEFAULT_SETTINGS.transcriptionModel,
    groqTextModel: isGroqTextModel(raw.groqTextModel)
      ? raw.groqTextModel
      : DEFAULT_SETTINGS.groqTextModel,
    geminiTextModel: isGeminiTextModel(raw.geminiTextModel)
      ? raw.geminiTextModel
      : DEFAULT_SETTINGS.geminiTextModel,
    theme: isThemePreference(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme,
    setupCompleted:
      typeof raw.setupCompleted === 'boolean' ? raw.setupCompleted : DEFAULT_SETTINGS.setupCompleted
  }
}

/** Aplica um patch vindo da UI, ignorando valores inválidos. */
export function applySettingsPatch(current: AppSettings, patch: SettingsPatch): AppSettings {
  const next = { ...current }
  if (patch.quality !== undefined && isQualityPreset(patch.quality)) next.quality = patch.quality
  if (patch.micDeviceId !== undefined) {
    next.micDeviceId =
      typeof patch.micDeviceId === 'string' && patch.micDeviceId !== '' ? patch.micDeviceId : null
  }
  if (typeof patch.systemAudio === 'boolean') next.systemAudio = patch.systemAudio
  if (typeof patch.compaction === 'boolean') next.compaction = patch.compaction
  if (patch.compactionMode !== undefined && isCompactionMode(patch.compactionMode)) {
    next.compactionMode = patch.compactionMode
  }
  if (patch.transcriptionModel !== undefined && isTranscriptionModel(patch.transcriptionModel)) {
    next.transcriptionModel = patch.transcriptionModel
  }
  if (patch.groqTextModel !== undefined && isGroqTextModel(patch.groqTextModel)) {
    next.groqTextModel = patch.groqTextModel
  }
  if (patch.geminiTextModel !== undefined && isGeminiTextModel(patch.geminiTextModel)) {
    next.geminiTextModel = patch.geminiTextModel
  }
  if (patch.noteShortcut !== undefined) {
    const accelerator = normalizeAccelerator(patch.noteShortcut)
    if (accelerator) next.noteShortcut = accelerator
  }
  if (validLeadSeconds(patch.noteLeadSeconds)) {
    next.noteLeadSeconds = Math.round(patch.noteLeadSeconds)
  }
  if (patch.theme !== undefined && isThemePreference(patch.theme)) next.theme = patch.theme
  if (typeof patch.setupCompleted === 'boolean') next.setupCompleted = patch.setupCompleted
  return next
}

export function serializeSettings(settings: AppSettings): string {
  return `${JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION, ...settings }, null, 2)}\n`
}
