import {
  DEFAULT_GEMINI_TEXT_MODEL,
  DEFAULT_GROQ_TEXT_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
  isGeminiTextModel,
  isGroqTextModel,
  isTranscriptionModel
} from './ai'
import { DEFAULT_QUALITY, isQualityPreset, type QualityPreset } from './capture'
import type { Point } from './floating'
import { DEFAULT_NOTE_LEAD_SECONDS, DEFAULT_NOTE_SHORTCUT, MAX_NOTE_LEAD_SECONDS } from './notes'

/**
 * Configurações persistidas em `userData/settings.json`. A tela de Configurações
 * completa é da Fase 8; por ora o app lê um padrão sensato e guarda a última escolha de
 * qualidade e microfone.
 */
/** Codificador do Vídeo ao vivo: software (padrão) ou hardware (NVENC/QSV/AMF via Media Foundation). */
export const VIDEO_ENCODERS = ['software', 'hardware'] as const
export type VideoEncoder = (typeof VIDEO_ENCODERS)[number]

export function isVideoEncoder(value: unknown): value is VideoEncoder {
  return typeof value === 'string' && (VIDEO_ENCODERS as readonly string[]).includes(value)
}

export interface AppSettings {
  /** Pasta das Reuniões; `null` = `Documentos\ClearMeet`. */
  meetingsDir: string | null
  /**
   * Compactação ligada (padrão, ADR 0003): define o bitrate ao vivo. A Fase 7 cria a
   * Compactação em si e a Fase 8 expõe a opção.
   */
  compaction: boolean
  quality: QualityPreset
  /**
   * Codificador H.264 do Vídeo ao vivo. É uma opção de processo do Chromium: o main a lê do
   * `settings.json` ao iniciar e só vale depois de reiniciar o app (a tela de Configurações da
   * Fase 8 deve avisar "requer reiniciar"). Padrão: `software`, porque o codificador por
   * hardware travava de forma intermitente nos testes da Fase 2.
   */
  videoEncoder: VideoEncoder
  /** Último microfone escolhido; `null` = padrão do sistema; `'none'` = gravar sem microfone. */
  micDeviceId: string | null
  /**
   * Atalho global que abre o campo de Anotação durante a gravação (formato de acelerador do
   * Electron). Só vale ao iniciar a gravação; a tela de Configurações é da Fase 8.
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
}

export const DEFAULT_SETTINGS: AppSettings = {
  meetingsDir: null,
  compaction: true,
  quality: DEFAULT_QUALITY,
  videoEncoder: 'software',
  micDeviceId: null,
  noteShortcut: DEFAULT_NOTE_SHORTCUT,
  noteLeadSeconds: DEFAULT_NOTE_LEAD_SECONDS,
  barPosition: null,
  transcriptionModel: DEFAULT_TRANSCRIPTION_MODEL,
  groqTextModel: DEFAULT_GROQ_TEXT_MODEL,
  geminiTextModel: DEFAULT_GEMINI_TEXT_MODEL
}

export const SETTINGS_SCHEMA_VERSION = 1

/** Configurações vistas pela UI: as gravadas mais a pasta efetiva das Reuniões. */
export interface SettingsView extends AppSettings {
  resolvedMeetingsDir: string
}

/** O que a UI pode alterar nesta fase. */
export type SettingsPatch = Partial<
  Pick<
    AppSettings,
    'quality' | 'micDeviceId' | 'transcriptionModel' | 'groqTextModel' | 'geminiTextModel'
  >
>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
    quality: isQualityPreset(raw.quality) ? raw.quality : DEFAULT_SETTINGS.quality,
    videoEncoder: isVideoEncoder(raw.videoEncoder)
      ? raw.videoEncoder
      : DEFAULT_SETTINGS.videoEncoder,
    micDeviceId,
    noteShortcut:
      typeof raw.noteShortcut === 'string' && raw.noteShortcut.trim() !== ''
        ? raw.noteShortcut.trim()
        : DEFAULT_SETTINGS.noteShortcut,
    noteLeadSeconds:
      typeof raw.noteLeadSeconds === 'number' &&
      Number.isFinite(raw.noteLeadSeconds) &&
      raw.noteLeadSeconds >= 0 &&
      raw.noteLeadSeconds <= MAX_NOTE_LEAD_SECONDS
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
      : DEFAULT_SETTINGS.geminiTextModel
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
  if (patch.transcriptionModel !== undefined && isTranscriptionModel(patch.transcriptionModel)) {
    next.transcriptionModel = patch.transcriptionModel
  }
  if (patch.groqTextModel !== undefined && isGroqTextModel(patch.groqTextModel)) {
    next.groqTextModel = patch.groqTextModel
  }
  if (patch.geminiTextModel !== undefined && isGeminiTextModel(patch.geminiTextModel)) {
    next.geminiTextModel = patch.geminiTextModel
  }
  return next
}

export function serializeSettings(settings: AppSettings): string {
  return `${JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION, ...settings }, null, 2)}\n`
}
