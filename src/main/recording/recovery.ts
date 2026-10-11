import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { MEETING_FILE, MEETING_FILES, needsRecovery } from '@shared/meeting'
import type { RecoveryItem } from '@shared/recording'
import type { FfmpegTools, RunProcess } from '../ffmpeg/media'
import { removeWithRetry } from '../fs/atomic'
import { listMeetingFolders, readMeeting, writeMeeting } from '../meetings/repository'
import { applyFinalize, finalizeParts } from './finalize'

export interface RecoveryOptions {
  meetingsDir: string
  /** FFmpeg disponível agora; `null` deixa as Reuniões pendentes (pedaços preservados). */
  getTools: () => Promise<FfmpegTools | null>
  /** Pastas que não devem ser tocadas (a Reunião sendo gravada neste momento). */
  skip?: ReadonlySet<string>
  run?: RunProcess
}

/** Maior data de modificação entre os arquivos da pasta: estima quando a gravação parou. */
async function lastActivity(folder: string): Promise<Date | null> {
  let latest: Date | null = null
  for (const name of [
    MEETING_FILES.videoPart,
    MEETING_FILES.audioPart,
    MEETING_FILES.video,
    MEETING_FILES.audio
  ]) {
    try {
      const { mtime, size } = await stat(join(folder, name))
      if (size > 0 && (!latest || mtime > latest)) latest = mtime
    } catch {
      // arquivo ausente
    }
  }
  return latest
}

/** A pasta só tem o `meeting.json` e pedaços vazios? Então não há nada do usuário a perder. */
async function isEmptyRecording(folder: string): Promise<boolean> {
  for (const name of await readdir(folder)) {
    if (name === MEETING_FILE) continue
    if (name !== MEETING_FILES.videoPart && name !== MEETING_FILES.audioPart) return false
    if ((await stat(join(folder, name))).size > 0) return false
  }
  return true
}

/**
 * Procura Reuniões com a gravação interrompida (status diferente de `ready`) e as recupera a
 * partir dos pedaços: remux, validação e `ready`. Pastas que não são Reuniões ou cujo
 * `meeting.json` é inválido são ignoradas (nunca alteradas).
 */
export async function recoverInterrupted(options: RecoveryOptions): Promise<RecoveryItem[]> {
  const items: RecoveryItem[] = []
  let tools: FfmpegTools | null | undefined

  for (const folder of await listMeetingFolders(options.meetingsDir)) {
    if (options.skip?.has(folder)) continue
    const read = await readMeeting(folder)
    if (!read.ok || !needsRecovery(read.value.status)) continue
    const meeting = read.value
    const base = { folder, name: meeting.name }

    try {
      if (await isEmptyRecording(folder)) {
        await removeWithRetry(folder, { recursive: true })
        items.push({
          ...base,
          outcome: 'discarded',
          durationMs: null,
          reason: 'A gravação foi interrompida antes de gravar qualquer dado.'
        })
        continue
      }

      tools ??= await options.getTools()
      if (!tools) {
        items.push({
          ...base,
          outcome: 'pending',
          durationMs: null,
          reason: 'FFmpeg indisponível: os arquivos serão recuperados quando ele estiver instalado.'
        })
        continue
      }

      const activity = (await lastActivity(folder)) ?? new Date(meeting.createdAt)
      const outcome = await finalizeParts(folder, tools, options.run)
      const updated = applyFinalize(meeting, outcome, activity.toISOString())
      await writeMeeting(folder, updated)
      items.push({
        ...base,
        outcome: updated.status === 'ready' ? 'recovered' : 'failed',
        durationMs: updated.durationMs,
        reason: outcome.issues.length > 0 ? outcome.issues.join(' ') : null
      })
    } catch (error) {
      items.push({
        ...base,
        outcome: 'failed',
        durationMs: null,
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return items
}
