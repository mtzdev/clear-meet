import { runProcess, type FfmpegTools, type RunProcess } from '../../ffmpeg/media'
import type { ChunkPlan } from './plan'

/** Tipo MIME de um `.opus` (Opus dentro de Ogg) para a File API. */
export const CHUNK_MIME_TYPE = 'audio/ogg'

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3)
}

/**
 * Recorta o trecho do bloco do Áudio da reunião. Recodifica (Opus mono 48 kbps) em vez de copiar
 * o fluxo: o corte com `-c copy` num Ogg começa até 0,5 s antes do pedido e desalinharia os
 * Instantes; recodificar é exato e, em áudio de voz, custa poucos segundos.
 */
export async function extractChunk(
  tools: FfmpegTools,
  input: string,
  output: string,
  plan: ChunkPlan,
  run: RunProcess = runProcess
): Promise<void> {
  const result = await run(tools.ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-ss',
    seconds(plan.startMs),
    '-t',
    seconds(plan.endMs - plan.startMs),
    '-i',
    input,
    '-map',
    '0:a',
    '-c:a',
    'libopus',
    '-b:a',
    '48k',
    '-ac',
    '1',
    '-f',
    'opus',
    output
  ])
  if (result.code !== 0) {
    const detail = result.stderr.trim().split(/\r?\n/).slice(-2).join(' | ') || 'sem detalhes'
    throw new Error(`ffmpeg falhou ao dividir o áudio: ${detail}`)
  }
}
