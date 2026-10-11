import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { FfmpegTools, ProcessResult, RunProcess } from '../ffmpeg/media'

/** Caminhos falsos: com `RunProcess` injetado, nenhum binário é executado. */
export const FAKE_TOOLS: FfmpegTools = { ffmpegPath: 'ffmpeg-falso', ffprobePath: 'ffprobe-falso' }

export interface FakeMediaOptions {
  /** Duração (s) que o `ffprobe` falso devolve. */
  durationSec?: number
  /** Faz o remux deste tipo falhar (`ffmpeg` sai com código 1). */
  failRemux?: 'video' | 'audio'
  /** Faz o arquivo de vídeo remuxado não ter trilha de vídeo (nenhum quadro gravado). */
  videoWithoutFrames?: boolean
  width?: number
  height?: number
}

export interface FakeMedia {
  run: RunProcess
  /** Linhas de comando executadas (`[executável, ...argumentos]`). */
  calls: string[][]
}

const ok = (stdout = ''): ProcessResult => ({ code: 0, stdout, stderr: '' })

/**
 * `ffmpeg`/`ffprobe` falsos para testar o pós-processamento sem binários: o "remux" cria o
 * arquivo de saída e o `ffprobe` descreve o arquivo pelo nome (`.mp4` = vídeo+áudio, `.opus` = áudio).
 */
export function createFakeMedia(options: FakeMediaOptions = {}): FakeMedia {
  const { durationSec = 10, width = 1920, height = 1080 } = options
  const calls: string[][] = []

  const run: RunProcess = async (file, args) => {
    calls.push([file, ...args])
    if (file === FAKE_TOOLS.ffmpegPath) {
      const output = args.at(-1) ?? ''
      const kind = output.endsWith('.mp4') ? 'video' : 'audio'
      if (options.failRemux === kind) {
        return { code: 1, stdout: '', stderr: 'Invalid data found when processing input' }
      }
      await writeFile(output, `remux:${kind}`)
      return ok()
    }

    const target = basename(args.at(-1) ?? '')
    const streams: Record<string, unknown>[] = []
    if (target.endsWith('.mp4') && !options.videoWithoutFrames) {
      streams.push({ codec_type: 'video', codec_name: 'h264', width, height })
    }
    streams.push({
      codec_type: 'audio',
      codec_name: 'opus',
      channels: 1,
      sample_rate: '48000',
      duration: String(durationSec)
    })
    return ok(
      JSON.stringify({
        format: {
          format_name: target.endsWith('.mp4') ? 'mov,mp4' : 'ogg',
          duration: String(durationSec)
        },
        streams
      })
    )
  }
  return { run, calls }
}
