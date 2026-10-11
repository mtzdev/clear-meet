import { DEFAULT_QUALITY, isQualityPreset, type QualityPreset } from './capture'

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
}

export const DEFAULT_SETTINGS: AppSettings = {
  meetingsDir: null,
  compaction: true,
  quality: DEFAULT_QUALITY,
  videoEncoder: 'software',
  micDeviceId: null
}

export const SETTINGS_SCHEMA_VERSION = 1

/** Configurações vistas pela UI: as gravadas mais a pasta efetiva das Reuniões. */
export interface SettingsView extends AppSettings {
  resolvedMeetingsDir: string
}

/** O que a UI pode alterar nesta fase. */
export type SettingsPatch = Partial<Pick<AppSettings, 'quality' | 'micDeviceId'>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
    micDeviceId
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
  return next
}

export function serializeSettings(settings: AppSettings): string {
  return `${JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION, ...settings }, null, 2)}\n`
}
