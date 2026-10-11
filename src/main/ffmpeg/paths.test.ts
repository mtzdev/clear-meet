import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveFfmpeg, type ResolveOptions } from './paths'

const downloadedRoot = join('C:', 'userData', 'ffmpeg')
const vendorRoot = join('C:', 'repo', 'vendor', 'ffmpeg')
const version = '9.0.2'

function options(existing: string[], overrides: Partial<ResolveOptions> = {}): ResolveOptions {
  const files = new Set(existing)
  return {
    env: {},
    downloadedRoot,
    vendorRoot,
    version,
    exists: (path) => files.has(path),
    ...overrides
  }
}

const downloaded = (name: string): string => join(downloadedRoot, version, name)
const vendor = (name: string): string => join(vendorRoot, version, name)

describe('resolveFfmpeg', () => {
  it('retorna null quando nada está instalado', () => {
    expect(resolveFfmpeg(options([]))).toBeNull()
  })

  it('FFMPEG_PATH tem prioridade sobre o baixado e o vendor', () => {
    const envFfmpeg = join('D:', 'tools', 'ffmpeg.exe')
    const result = resolveFfmpeg(
      options(
        [
          envFfmpeg,
          join('D:', 'tools', 'ffprobe.exe'),
          downloaded('ffmpeg.exe'),
          vendor('ffmpeg.exe')
        ],
        { env: { FFMPEG_PATH: envFfmpeg } }
      )
    )
    expect(result).toEqual({
      source: 'env',
      ffmpegPath: envFfmpeg,
      ffprobePath: join('D:', 'tools', 'ffprobe.exe')
    })
  })

  it('FFPROBE_PATH sobrescreve o ffprobe vizinho', () => {
    const envFfmpeg = join('D:', 'tools', 'ffmpeg.exe')
    const envProbe = join('E:', 'probe', 'ffprobe.exe')
    const result = resolveFfmpeg(
      options([envFfmpeg, envProbe, join('D:', 'tools', 'ffprobe.exe')], {
        env: { FFMPEG_PATH: envFfmpeg, FFPROBE_PATH: envProbe }
      })
    )
    expect(result?.ffprobePath).toBe(envProbe)
  })

  it('ignora FFMPEG_PATH que aponta para arquivo inexistente', () => {
    const result = resolveFfmpeg(
      options([downloaded('ffmpeg.exe'), downloaded('ffprobe.exe')], {
        env: { FFMPEG_PATH: join('D:', 'missing', 'ffmpeg.exe') }
      })
    )
    expect(result?.source).toBe('downloaded')
  })

  it('prefere o binário baixado ao vendor', () => {
    const result = resolveFfmpeg(
      options([
        downloaded('ffmpeg.exe'),
        downloaded('ffprobe.exe'),
        vendor('ffmpeg.exe'),
        vendor('ffprobe.exe')
      ])
    )
    expect(result).toEqual({
      source: 'downloaded',
      ffmpegPath: downloaded('ffmpeg.exe'),
      ffprobePath: downloaded('ffprobe.exe')
    })
  })

  it('usa o vendor quando não há baixado', () => {
    const result = resolveFfmpeg(options([vendor('ffmpeg.exe'), vendor('ffprobe.exe')]))
    expect(result?.source).toBe('vendor')
  })

  it('não olha o vendor quando vendorRoot é null (app empacotado)', () => {
    const result = resolveFfmpeg(
      options([vendor('ffmpeg.exe'), vendor('ffprobe.exe')], { vendorRoot: null })
    )
    expect(result).toBeNull()
  })

  it('devolve ffprobePath null quando o ffprobe não existe ao lado do ffmpeg', () => {
    const result = resolveFfmpeg(options([downloaded('ffmpeg.exe')]))
    expect(result?.ffprobePath).toBeNull()
  })

  it('só considera a versão fixada', () => {
    const other = join(downloadedRoot, '8.0', 'ffmpeg.exe')
    expect(resolveFfmpeg(options([other]))).toBeNull()
  })
})
