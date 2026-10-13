import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FFMPEG_BUILD } from '../../ffmpeg/config'
import { runProcess, type FfmpegTools, type RunProcess } from '../../ffmpeg/media'
import { resolveFfmpeg } from '../../ffmpeg/paths'
import type { ChunkPlan } from './plan'
import { extractChunk } from './split'

const plan: ChunkPlan = {
  index: 1,
  startMs: 20_500,
  endMs: 50_500,
  ownFromMs: 0,
  ownToMs: 0
}

describe('extractChunk (comando)', () => {
  const tools: FfmpegTools = { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' }

  it('corta com -ss/-t antes da entrada e recodifica em Opus mono', async () => {
    const calls: string[][] = []
    const run: RunProcess = (_file, args) => {
      calls.push(args)
      return Promise.resolve({ code: 0, stdout: '', stderr: '' })
    }
    await extractChunk(tools, 'in.opus', 'out.opus', plan, run)
    const args = calls[0]!
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(args[args.indexOf('-ss') + 1]).toBe('20.500')
    expect(args[args.indexOf('-t') + 1]).toBe('30.000')
    expect(args).toContain('libopus')
    expect(args).not.toContain('copy')
    expect(args.at(-1)).toBe('out.opus')
  })

  it('falha do FFmpeg vira erro com o motivo', async () => {
    const run: RunProcess = () =>
      Promise.resolve({ code: 1, stdout: '', stderr: 'Invalid data found\n' })
    await expect(extractChunk(tools, 'in.opus', 'out.opus', plan, run)).rejects.toThrow(
      /Invalid data found/
    )
  })
})

const resolved = resolveFfmpeg({
  env: process.env,
  downloadedRoot: join(tmpdir(), 'clearmeet-sem-ffmpeg'),
  vendorRoot: resolve(__dirname, '../../../../vendor/ffmpeg'),
  version: FFMPEG_BUILD.version
})
const realTools: FfmpegTools | null =
  resolved && resolved.ffprobePath
    ? { ffmpegPath: resolved.ffmpegPath, ffprobePath: resolved.ffprobePath }
    : null

/** Com o FFmpeg real: o bipe a 30,0 s do original tem de cair a 9,5 s no trecho que começa em 20,5 s. */
describe.skipIf(!realTools)('extractChunk com FFmpeg real', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'clearmeet-split-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('o corte é exato (Instantes não deslizam)', async () => {
    if (!realTools) return
    const source = join(dir, 'fonte.opus')
    execFileSync(
      realTools.ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        "aevalsrc='if(between(t,30,31),0.5*sin(2*PI*440*t),0)':d=70:s=48000",
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        '-ac',
        '1',
        source
      ],
      { windowsHide: true }
    )
    const out = join(dir, 'bloco.opus')
    await extractChunk(realTools, source, out, plan)

    const result = await runProcess(realTools.ffmpegPath, [
      '-hide_banner',
      '-nostdin',
      '-i',
      out,
      '-af',
      'silencedetect=n=-40dB:d=0.3',
      '-f',
      'null',
      '-'
    ])
    const ends = [...result.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
    // A primeira região de silêncio termina quando o bipe começa.
    expect(ends[0]).toBeGreaterThan(9.3)
    expect(ends[0]).toBeLessThan(9.7)
  })
})
