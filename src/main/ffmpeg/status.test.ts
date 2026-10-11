import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FFMPEG_BUILD } from './config'
import { ENCODERS_OUTPUT, VERSION_OUTPUT } from './probe-fixture'
import type { RunFn } from './probe'
import { getFfmpegStatus } from './status'

const base = {
  downloadedRoot: join('C:', 'userData', 'ffmpeg'),
  vendorRoot: null
}

const okRun: RunFn = (_file, args) =>
  Promise.resolve({ stdout: args.includes('-encoders') ? ENCODERS_OUTPUT : VERSION_OUTPUT })

describe('getFfmpegStatus', () => {
  it('indisponível quando nada foi encontrado', async () => {
    const status = await getFfmpegStatus({ ...base, env: {} })
    expect(status).toMatchObject({
      available: false,
      source: null,
      version: null,
      hasLibSvtAv1: false,
      pinnedVersion: FFMPEG_BUILD.version
    })
    expect(status.error).toContain('não instalado')
  })

  it('disponível com versão e libsvtav1 quando os binários respondem', async () => {
    // Os caminhos de FFMPEG_PATH precisam existir de verdade; usamos o próprio node como "ffmpeg".
    const node = process.execPath
    const status = await getFfmpegStatus({
      ...base,
      env: { FFMPEG_PATH: node, FFPROBE_PATH: node },
      run: okRun
    })
    expect(status).toMatchObject({
      available: true,
      source: 'env',
      ffmpegPath: node,
      version: '9.0.2-full_build-www.gyan.dev',
      hasLibSvtAv1: true,
      error: null
    })
  })

  it('indisponível com o motivo quando o binário não executa', async () => {
    const node = process.execPath
    const status = await getFfmpegStatus({
      ...base,
      env: { FFMPEG_PATH: node, FFPROBE_PATH: node },
      run: () => Promise.reject(new Error('spawn UNKNOWN'))
    })
    expect(status.available).toBe(false)
    expect(status.source).toBe('env')
    expect(status.error).toBe('spawn UNKNOWN')
  })

  it('indisponível quando falta o ffprobe', async () => {
    const node = process.execPath
    const status = await getFfmpegStatus({
      ...base,
      env: { FFMPEG_PATH: node },
      run: okRun
    })
    expect(status.available).toBe(false)
    expect(status.error).toContain('ffprobe')
  })
})
