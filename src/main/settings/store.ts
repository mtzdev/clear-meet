import { readFileSync } from 'node:fs'
import { mkdir, readFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  applySettingsPatch,
  parseSettings,
  serializeSettings,
  type AppSettings,
  type SettingsPatch,
  type SettingsView,
  type VideoEncoder
} from '@shared/settings'
import type { Point } from '@shared/floating'
import { writeFileAtomic } from '../fs/atomic'

export const SETTINGS_FILE = 'settings.json'
export const DEFAULT_MEETINGS_FOLDER = 'ClearMeet'

/** Pasta efetiva das Reuniões: a configurada ou `Documentos\ClearMeet`. */
export function resolveMeetingsDir(settings: AppSettings, documentsPath: string): string {
  return settings.meetingsDir ?? join(documentsPath, DEFAULT_MEETINGS_FOLDER)
}

/**
 * Codificador de vídeo escolhido, lido de forma síncrona e antes do app estar pronto: a flag do
 * Chromium (`--disable-accelerated-video-encode`) precisa ser definida antes do `ready`.
 * Arquivo ausente ou inválido = padrão.
 */
export function readVideoEncoderSync(userDataDir: string): VideoEncoder {
  try {
    const text = readFileSync(join(userDataDir, SETTINGS_FILE), 'utf8')
    return parseSettings(JSON.parse(text.replace(/^\uFEFF/, ''))).videoEncoder
  } catch {
    return parseSettings(null).videoEncoder
  }
}

/**
 * Configurações em JSON dentro de `userData`: leitura validada, escrita atômica.
 * Arquivo ausente = padrões; arquivo corrompido é guardado como `settings.corrupt.json`
 * (para o usuário não perder o que tinha) e os padrões voltam a valer.
 */
export class SettingsStore {
  private current: AppSettings = parseSettings(null)
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly userDataDir: string,
    private readonly documentsPath: string
  ) {}

  private get file(): string {
    return join(this.userDataDir, SETTINGS_FILE)
  }

  async load(): Promise<AppSettings> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch {
      this.current = parseSettings(null)
      return this.current
    }
    try {
      this.current = parseSettings(JSON.parse(text.replace(/^\uFEFF/, '')))
    } catch {
      await rename(this.file, join(dirname(this.file), 'settings.corrupt.json')).catch(
        () => undefined
      )
      this.current = parseSettings(null)
    }
    return this.current
  }

  get(): AppSettings {
    return this.current
  }

  view(): SettingsView {
    return {
      ...this.current,
      resolvedMeetingsDir: resolveMeetingsDir(this.current, this.documentsPath)
    }
  }

  /** Aplica o patch, grava (serializado, para duas alterações seguidas não se atropelarem) e devolve a visão nova. */
  async update(patch: SettingsPatch): Promise<SettingsView> {
    this.current = applySettingsPatch(this.current, patch)
    await this.persist()
    return this.view()
  }

  /** Lembra onde a barra flutuante foi deixada (uso interno do main, não vem da UI). */
  async setBarPosition(position: Point): Promise<void> {
    this.current = {
      ...this.current,
      barPosition: { x: Math.round(position.x), y: Math.round(position.y) }
    }
    await this.persist()
  }

  private async persist(): Promise<void> {
    const text = serializeSettings(this.current)
    const write = this.writing.then(async () => {
      await mkdir(this.userDataDir, { recursive: true })
      await writeFileAtomic(this.file, text)
    })
    this.writing = write.catch(() => undefined)
    await write
  }
}
