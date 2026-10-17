import { describe, expect, it } from 'vitest'
import type { MediaInfo, ProcessResult, RunProcess } from '../ffmpeg/media'
import { validateCompacted } from './validate'

const tools = { ffmpegPath: 'ffmpeg.exe', ffprobePath: 'ffprobe.exe' }
const ok: ProcessResult = { code: 0, stdout: '', stderr: '' }
const failed: ProcessResult = { code: 1, stdout: '', stderr: 'erro' }

function probeJson(duration: number, streams: { type: string; codec: string }[]): string {
  return JSON.stringify({
    format: { duration: String(duration) },
    streams: streams.map((stream) => ({ codec_type: stream.type, codec_name: stream.codec }))
  })
}

const AV1_WITH_AUDIO = probeJson(600.4, [
  { type: 'video', codec: 'av1' },
  { type: 'audio', codec: 'opus' }
])

const original: MediaInfo = {
  formatName: 'mov,mp4',
  durationSec: 600,
  sizeBytes: 1000,
  streams: [
    {
      type: 'video',
      codec: 'h264',
      width: 1920,
      height: 1080,
      channels: null,
      sampleRate: null,
      durationSec: 600,
      startTimeSec: 0
    },
    {
      type: 'audio',
      codec: 'opus',
      width: null,
      height: null,
      channels: 1,
      sampleRate: 48000,
      durationSec: 600,
      startTimeSec: 0
    }
  ]
}

interface Options {
  probe?: string
  probeCode?: number
  decode?: (args: string[]) => ProcessResult
}

function fakeRun(options: Options = {}): { run: RunProcess; decoded: string[][] } {
  const decoded: string[][] = []
  const run: RunProcess = (file, args) => {
    if (file === tools.ffprobePath) {
      return Promise.resolve({
        code: options.probeCode ?? 0,
        stdout: options.probe ?? AV1_WITH_AUDIO,
        stderr: 'ruim'
      })
    }
    decoded.push(args)
    return Promise.resolve(options.decode ? options.decode(args) : ok)
  }
  return { run, decoded }
}

describe('validateCompacted', () => {
  it('aceita vídeo AV1 com áudio, duração dentro de 1 s e início e fim decodificáveis', async () => {
    const { run, decoded } = fakeRun()
    const result = await validateCompacted(tools, original, 'out.mp4', run)
    expect(result.ok).toBe(true)
    expect(decoded).toHaveLength(2)
    expect(decoded[0]).toEqual(expect.arrayContaining(['-t', '3', '-i', 'out.mp4']))
    expect(decoded[1]).toEqual(expect.arrayContaining(['-sseof', '-3', '-i', 'out.mp4']))
  })

  it('recusa duração diferente em mais de 1 s', async () => {
    const { run } = fakeRun({
      probe: probeJson(598.5, [
        { type: 'video', codec: 'av1' },
        { type: 'audio', codec: 'opus' }
      ])
    })
    const result = await validateCompacted(tools, original, 'out.mp4', run)
    expect(!result.ok && result.reason).toContain('duração')
  })

  it('recusa arquivo sem vídeo AV1', async () => {
    const { run } = fakeRun({
      probe: probeJson(600, [
        { type: 'video', codec: 'h264' },
        { type: 'audio', codec: 'opus' }
      ])
    })
    expect((await validateCompacted(tools, original, 'out.mp4', run)).ok).toBe(false)
  })

  it('recusa quando o áudio do original sumiu, mas aceita se o original não tinha', async () => {
    const noAudio = probeJson(600, [{ type: 'video', codec: 'av1' }])
    const lost = await validateCompacted(
      tools,
      original,
      'out.mp4',
      fakeRun({ probe: noAudio }).run
    )
    expect(lost.ok).toBe(false)
    const silent = { ...original, streams: original.streams.slice(0, 1) }
    const kept = await validateCompacted(tools, silent, 'out.mp4', fakeRun({ probe: noAudio }).run)
    expect(kept.ok).toBe(true)
  })

  it('recusa quando o ffprobe falha', async () => {
    const { run } = fakeRun({ probeCode: 1 })
    expect((await validateCompacted(tools, original, 'out.mp4', run)).ok).toBe(false)
  })

  it('recusa quando o fim não decodifica', async () => {
    const { run } = fakeRun({ decode: (args) => (args.includes('-sseof') ? failed : ok) })
    const result = await validateCompacted(tools, original, 'out.mp4', run)
    expect(!result.ok && result.reason).toContain('fim')
  })

  it('recusa quando o início não decodifica', async () => {
    const { run } = fakeRun({ decode: (args) => (args.includes('-t') ? failed : ok) })
    const result = await validateCompacted(tools, original, 'out.mp4', run)
    expect(!result.ok && result.reason).toContain('início')
  })

  it('sem duração medida não valida', async () => {
    const { run } = fakeRun()
    const result = await validateCompacted(
      tools,
      { ...original, durationSec: null },
      'out.mp4',
      run
    )
    expect(result.ok).toBe(false)
  })
})
