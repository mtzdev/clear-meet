import { describe, expect, it } from 'vitest'
import type { ProcessResult, RunProcess } from '../ffmpeg/media'
import { ENCODERS_OUTPUT } from '../ffmpeg/probe-fixture'
import { Av1EncoderDetector, detectAv1Encoder } from './encoders'

const tools = { ffmpegPath: 'ffmpeg.exe', ffprobePath: 'ffprobe.exe' }
const ok: ProcessResult = { code: 0, stdout: '', stderr: '' }
const bad: ProcessResult = { code: 1, stdout: '', stderr: 'No capable devices found' }

const ALL_LISTED = `${ENCODERS_OUTPUT} V....D av1_qsv            AV1 (Intel Quick Sync Video acceleration) (codec av1)
 V....D av1_amf            AMD AMF AV1 encoder (codec av1)
`

/** FFmpeg de mentira: `-encoders` devolve `listing` e cada encoder responde conforme `works`. */
function fakeRun(listing: string, works: string[]): { run: RunProcess; tried: string[] } {
  const tried: string[] = []
  const run: RunProcess = (_file, args) => {
    if (args.includes('-encoders')) return Promise.resolve({ ...ok, stdout: listing })
    const encoder = args[args.indexOf('-c:v') + 1] as string
    tried.push(encoder)
    return Promise.resolve(works.includes(encoder) ? ok : bad)
  }
  return { run, tried }
}

describe('detectAv1Encoder', () => {
  it('prefere o hardware que funciona, na ordem nvenc, qsv, amf', async () => {
    const { run, tried } = fakeRun(ALL_LISTED, ['av1_nvenc', 'av1_qsv', 'libsvtav1'])
    expect(await detectAv1Encoder(tools, run)).toBe('av1_nvenc')
    expect(tried).toEqual(['av1_nvenc'])
  })

  it('listado mas sem a placa (falha no encode de teste): tenta o próximo', async () => {
    const { run, tried } = fakeRun(ALL_LISTED, ['av1_amf', 'libsvtav1'])
    expect(await detectAv1Encoder(tools, run)).toBe('av1_amf')
    expect(tried).toEqual(['av1_nvenc', 'av1_qsv', 'av1_amf'])
  })

  it('sem nenhum hardware cai para o libsvtav1', async () => {
    const { run } = fakeRun(ALL_LISTED, ['libsvtav1'])
    expect(await detectAv1Encoder(tools, run)).toBe('libsvtav1')
  })

  it('não testa encoder que o build nem lista', async () => {
    // ENCODERS_OUTPUT lista av1_nvenc e libsvtav1, mas não av1_qsv nem av1_amf
    const { run, tried } = fakeRun(ENCODERS_OUTPUT, ['av1_nvenc', 'libsvtav1'])
    await detectAv1Encoder(tools, run)
    expect(tried).not.toContain('av1_qsv')
    expect(tried).not.toContain('av1_amf')
  })

  it('nenhum encoder funcionando devolve null', async () => {
    const { run } = fakeRun(ALL_LISTED, [])
    expect(await detectAv1Encoder(tools, run)).toBeNull()
  })

  it('o teste é um encode curto de verdade (1 s de testsrc)', async () => {
    let testArgs: string[] = []
    const run: RunProcess = (_file, args) => {
      if (args.includes('-encoders')) return Promise.resolve({ ...ok, stdout: ALL_LISTED })
      testArgs = args
      return Promise.resolve(ok)
    }
    await detectAv1Encoder(tools, run)
    expect(testArgs).toEqual(expect.arrayContaining(['-f', 'lavfi', '-i']))
    expect(testArgs.join(' ')).toContain('testsrc=duration=1')
    expect(testArgs.slice(-3)).toEqual(['-f', 'null', '-'])
  })
})

describe('Av1EncoderDetector', () => {
  it('detecta uma vez por FFmpeg e reaproveita o resultado', async () => {
    let calls = 0
    const base = fakeRun(ALL_LISTED, ['libsvtav1']).run
    const run: RunProcess = (file, args, options) => {
      calls += 1
      return base(file, args, options)
    }
    const detector = new Av1EncoderDetector(run)
    expect(await detector.get(tools)).toBe('libsvtav1')
    const after = calls
    expect(await detector.get(tools)).toBe('libsvtav1')
    expect(calls).toBe(after)
  })

  it('erro ao detectar vira "nenhum encoder", sem lançar', async () => {
    const detector = new Av1EncoderDetector(() => Promise.reject(new Error('sem processo')))
    expect(await detector.get(tools)).toBeNull()
  })
})
