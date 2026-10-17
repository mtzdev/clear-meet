import { describe, expect, it } from 'vitest'
import { buildCompactionArgs } from './args'

const base = { input: 'in.mp4', output: 'out.mp4', hasAudio: true } as const

function pair(args: string[], flag: string): string | undefined {
  return args[args.indexOf(flag) + 1]
}

describe('buildCompactionArgs', () => {
  it('libsvtav1 no modo velocidade usa os parâmetros de partida', () => {
    const args = buildCompactionArgs({ ...base, encoder: 'libsvtav1', mode: 'speed' })
    expect(pair(args, '-c:v')).toBe('libsvtav1')
    expect(pair(args, '-preset')).toBe('8')
    expect(pair(args, '-crf')).toBe('45')
    expect(pair(args, '-g')).toBe('150')
    expect(pair(args, '-pix_fmt')).toBe('yuv420p')
    expect(pair(args, '-svtav1-params')).toBe('tune=0:scm=1:enable-overlays=0')
    expect(pair(args, '-fps_mode')).toBe('passthrough')
  })

  it('qualidade máxima: preset mais lento e CRF mais baixo', () => {
    const args = buildCompactionArgs({ ...base, encoder: 'libsvtav1', mode: 'quality' })
    expect(pair(args, '-preset')).toBe('6')
    expect(pair(args, '-crf')).toBe('40')
  })

  it('áudio vira Opus mono de 32 kbps e o MP4 sai com faststart', () => {
    const args = buildCompactionArgs({ ...base, encoder: 'libsvtav1', mode: 'speed' })
    expect(pair(args, '-c:a')).toBe('libopus')
    expect(pair(args, '-ac')).toBe('1')
    expect(pair(args, '-b:a')).toBe('32k')
    expect(pair(args, '-movflags')).toBe('+faststart')
    expect(args.at(-1)).toBe('out.mp4')
    expect(args.indexOf('-i')).toBeLessThan(args.indexOf('-c:v'))
    expect(pair(args, '-i')).toBe('in.mp4')
  })

  it('pede o andamento por -progress e não espera entrada do teclado', () => {
    const args = buildCompactionArgs({ ...base, encoder: 'libsvtav1', mode: 'speed' })
    expect(pair(args, '-progress')).toBe('pipe:1')
    expect(args).toContain('-nostdin')
  })

  it('sem trilha de áudio no original, não mapeia nem recodifica áudio', () => {
    const args = buildCompactionArgs({
      ...base,
      hasAudio: false,
      encoder: 'libsvtav1',
      mode: 'speed'
    })
    expect(args).not.toContain('-c:a')
    expect(args).not.toContain('0:a:0')
    expect(args).toContain('0:v:0')
  })

  it.each([
    ['av1_nvenc', ['-rc', 'vbr', '-cq']],
    ['av1_qsv', ['-global_quality']],
    ['av1_amf', ['-rc', 'cqp']]
  ] as const)('%s usa os parâmetros de hardware correspondentes', (encoder, expected) => {
    const args = buildCompactionArgs({ ...base, encoder, mode: 'speed' })
    expect(pair(args, '-c:v')).toBe(encoder)
    expect(args).toEqual(expect.arrayContaining([...expected]))
    expect(args).not.toContain('-svtav1-params')
  })
})
