import type { CompactionMode } from '@shared/compaction'
import { cropFilter, type Rect } from '@shared/content-area'
import type { Av1Encoder } from './encoders'

export interface CompactionArgsInput {
  input: string
  output: string
  encoder: Av1Encoder
  mode: CompactionMode
  /** O original tem trilha de áudio; sem ela, nada é mapeado nem recodificado. */
  hasAudio: boolean
  /** Área útil: o vídeo sai só com ela, sem as faixas pretas. */
  crop?: Rect | null
}

/** Parâmetros do vídeo por encoder e modo. O software tem `scm=1` (ferramentas de conteúdo de tela). */
function videoArgs(encoder: Av1Encoder, mode: CompactionMode): string[] {
  const quality = mode === 'quality'
  switch (encoder) {
    case 'libsvtav1':
      return [
        '-c:v',
        'libsvtav1',
        '-preset',
        quality ? '6' : '8',
        '-crf',
        quality ? '40' : '45',
        '-g',
        '150',
        '-pix_fmt',
        'yuv420p',
        '-svtav1-params',
        'tune=0:scm=1:enable-overlays=0'
      ]
    case 'av1_nvenc':
      return [
        '-c:v',
        'av1_nvenc',
        '-preset',
        quality ? 'p7' : 'p5',
        '-tune',
        'hq',
        '-rc',
        'vbr',
        '-cq',
        quality ? '36' : '40',
        '-b:v',
        '0',
        '-g',
        '150'
      ]
    case 'av1_qsv':
      return [
        '-c:v',
        'av1_qsv',
        '-preset',
        quality ? 'veryslow' : 'slower',
        '-global_quality',
        quality ? '36' : '40',
        '-g',
        '150'
      ]
    case 'av1_amf':
      return [
        '-c:v',
        'av1_amf',
        '-usage',
        'transcoding',
        '-quality',
        quality ? 'high_quality' : 'quality',
        '-rc',
        'cqp',
        '-qp_i',
        quality ? '36' : '40',
        '-qp_p',
        quality ? '38' : '42',
        '-g',
        '150'
      ]
  }
}

/** Linha de comando da Compactação: vídeo em AV1, áudio em Opus mono 32 kbps, `+faststart`. */
export function buildCompactionArgs(input: CompactionArgsInput): string[] {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-nostats',
    '-progress',
    'pipe:1',
    '-y',
    '-i',
    input.input,
    '-map',
    '0:v:0',
    ...(input.hasAudio ? ['-map', '0:a:0'] : []),
    ...(input.crop ? ['-vf', cropFilter(input.crop)] : []),
    ...videoArgs(input.encoder, input.mode),
    '-fps_mode',
    'passthrough'
  ]
  if (input.hasAudio) args.push('-c:a', 'libopus', '-ac', '1', '-b:a', '32k')
  args.push('-movflags', '+faststart', '-f', 'mp4', input.output)
  return args
}
