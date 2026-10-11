import { describe, expect, it } from 'vitest'
import { ENCODERS_OUTPUT, VERSION_OUTPUT } from './probe-fixture'
import { parseEncoders, parseVersion, probeFfmpeg, probeFfprobe, type RunFn } from './probe'

describe('parseVersion', () => {
  it('extrai a versão da primeira linha', () => {
    expect(parseVersion(VERSION_OUTPUT)).toBe('9.0.2-full_build-www.gyan.dev')
  })

  it('funciona com ffprobe e builds git', () => {
    expect(parseVersion('ffprobe version N-118385-g0225fe857d-20250131 Copyright')).toBe(
      'N-118385-g0225fe857d-20250131'
    )
  })

  it('retorna null para saída desconhecida', () => {
    expect(parseVersion('command not found')).toBeNull()
  })
})

describe('parseEncoders', () => {
  it('lista os encoders e ignora a legenda de flags', () => {
    const encoders = parseEncoders(ENCODERS_OUTPUT)
    expect([...encoders].sort()).toEqual(['av1_nvenc', 'libopus', 'libsvtav1', 'libx264', 'srt'])
  })

  it('aceita quebras de linha do Windows', () => {
    const encoders = parseEncoders(ENCODERS_OUTPUT.replaceAll('\n', '\r\n'))
    expect(encoders.has('libsvtav1')).toBe(true)
  })

  it('devolve vazio sem a lista', () => {
    expect(parseEncoders('Encoders:\n V..... = Video\n').size).toBe(0)
  })
})

describe('probeFfmpeg / probeFfprobe', () => {
  const run: RunFn = (_file, args) =>
    Promise.resolve({ stdout: args.includes('-encoders') ? ENCODERS_OUTPUT : VERSION_OUTPUT })

  it('reporta versão e presença de libsvtav1', async () => {
    const probe = await probeFfmpeg('ffmpeg.exe', run)
    expect(probe.version).toBe('9.0.2-full_build-www.gyan.dev')
    expect(probe.hasLibSvtAv1).toBe(true)
  })

  it('reporta libsvtav1 ausente', async () => {
    const without: RunFn = (_file, args) =>
      Promise.resolve({
        stdout: args.includes('-encoders')
          ? ENCODERS_OUTPUT.replace(/.*libsvtav1.*\n/, '')
          : VERSION_OUTPUT
      })
    expect((await probeFfmpeg('ffmpeg.exe', without)).hasLibSvtAv1).toBe(false)
  })

  it('propaga falha de execução', async () => {
    const broken: RunFn = () => Promise.reject(new Error('spawn ENOENT'))
    await expect(probeFfmpeg('ffmpeg.exe', broken)).rejects.toThrow('spawn ENOENT')
  })

  it('rejeita saída sem versão', async () => {
    const garbage: RunFn = () => Promise.resolve({ stdout: 'olá' })
    await expect(probeFfmpeg('ffmpeg.exe', garbage)).rejects.toThrow('não reconhecida')
    await expect(probeFfprobe('ffprobe.exe', garbage)).rejects.toThrow('não reconhecida')
  })

  it('probeFfprobe devolve a versão', async () => {
    expect(await probeFfprobe('ffprobe.exe', run)).toBe('9.0.2-full_build-www.gyan.dev')
  })
})
