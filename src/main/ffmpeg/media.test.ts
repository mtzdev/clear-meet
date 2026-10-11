import { describe, expect, it } from 'vitest'
import { parseProbeJson, probeMedia, remuxFile, type RunProcess } from './media'

const tools = { ffmpegPath: 'ffmpeg.exe', ffprobePath: 'ffprobe.exe' }

describe('parseProbeJson', () => {
  it('interpreta formato e trilhas do ffprobe', () => {
    const info = parseProbeJson(
      JSON.stringify({
        format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '15.919433', size: '1098858' },
        streams: [
          { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, duration: '15.9' },
          {
            codec_type: 'audio',
            codec_name: 'opus',
            channels: 1,
            sample_rate: '48000',
            start_time: '0.000000'
          },
          { codec_type: 'data' }
        ]
      })
    )
    expect(info.durationSec).toBeCloseTo(15.919433)
    expect(info.sizeBytes).toBe(1098858)
    expect(info.streams.map((stream) => stream.type)).toEqual(['video', 'audio', 'other'])
    expect(info.streams[0]).toMatchObject({ codec: 'h264', width: 1920, height: 1080 })
    expect(info.streams[1]).toMatchObject({ channels: 1, sampleRate: 48000, startTimeSec: 0 })
  })

  it('campos ausentes ou inválidos viram null', () => {
    const info = parseProbeJson(JSON.stringify({ format: { duration: 'N/A' }, streams: [{}] }))
    expect(info.durationSec).toBeNull()
    expect(info.formatName).toBeNull()
    expect(info.streams[0]).toMatchObject({ type: 'other', codec: null, width: null })
  })

  it('lança se não for JSON', () => {
    expect(() => parseProbeJson('isto não é json')).toThrow()
  })
})

describe('probeMedia', () => {
  it('chama o ffprobe com o arquivo e devolve a análise', async () => {
    const calls: string[][] = []
    const run: RunProcess = (file, args) => {
      calls.push([file, ...args])
      return Promise.resolve({
        code: 0,
        stdout: JSON.stringify({ format: { duration: '3' }, streams: [] }),
        stderr: ''
      })
    }
    const info = await probeMedia(tools, 'a.mp4', run)
    expect(info.durationSec).toBe(3)
    expect(calls[0]?.[0]).toBe('ffprobe.exe')
    expect(calls[0]?.at(-1)).toBe('a.mp4')
  })

  it('falha com a mensagem do ffprobe', async () => {
    const run: RunProcess = () =>
      Promise.resolve({ code: 1, stdout: '', stderr: 'moov atom not found\n' })
    await expect(probeMedia(tools, 'a.mp4', run)).rejects.toThrow('moov atom not found')
  })
})

describe('remuxFile', () => {
  it('Vídeo: copia as trilhas para MP4 com faststart', async () => {
    let args: string[] = []
    const run: RunProcess = (_file, received) => {
      args = received
      return Promise.resolve({ code: 0, stdout: '', stderr: '' })
    }
    await remuxFile(tools, 'in.part.mp4', 'out.mp4', 'video', run)
    expect(args).toEqual(
      expect.arrayContaining(['-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', 'out.mp4'])
    )
    expect(args.indexOf('-i')).toBeLessThan(args.indexOf('out.mp4'))
  })

  it('Áudio da reunião: copia só o áudio para Ogg Opus (.opus)', async () => {
    let args: string[] = []
    const run: RunProcess = (_file, received) => {
      args = received
      return Promise.resolve({ code: 0, stdout: '', stderr: '' })
    }
    await remuxFile(tools, 'in.part.webm', 'out.opus', 'audio', run)
    expect(args).toEqual(expect.arrayContaining(['-map', '0:a', '-c', 'copy', '-f', 'opus']))
  })

  it('falha com o final do erro do ffmpeg', async () => {
    const run: RunProcess = () =>
      Promise.resolve({ code: 1, stdout: '', stderr: 'linha 1\nInvalid data found\n' })
    await expect(remuxFile(tools, 'a', 'b.mp4', 'video', run)).rejects.toThrow('Invalid data found')
  })
})
