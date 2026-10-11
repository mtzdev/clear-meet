import { describe, expect, it } from 'vitest'
import { FFMPEG_BUILD, selectArchiveEntry } from './config'

const top = 'ffmpeg-9.0.2-full_build-shared'

describe('FFMPEG_BUILD', () => {
  it('está fixado em versão, URL versionada e SHA-256 hexadecimal', () => {
    expect(FFMPEG_BUILD.version).toMatch(/^\d+\.\d+(\.\d+)?$/)
    expect(FFMPEG_BUILD.url).toContain(`/releases/download/${FFMPEG_BUILD.version}/`)
    expect(FFMPEG_BUILD.url).not.toMatch(/latest/i)
    expect(FFMPEG_BUILD.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(FFMPEG_BUILD.size).toBeGreaterThan(0)
  })
})

describe('selectArchiveEntry', () => {
  it('extrai ffmpeg, ffprobe, DLLs e licença', () => {
    expect(selectArchiveEntry(`${top}/bin/ffmpeg.exe`)).toBe('ffmpeg.exe')
    expect(selectArchiveEntry(`${top}/bin/ffprobe.exe`)).toBe('ffprobe.exe')
    expect(selectArchiveEntry(`${top}/bin/avcodec-63.dll`)).toBe('avcodec-63.dll')
    expect(selectArchiveEntry(`${top}/LICENSE`)).toBe('LICENSE.txt')
  })

  it('ignora ffplay, documentação, presets e pastas', () => {
    expect(selectArchiveEntry(`${top}/bin/ffplay.exe`)).toBeNull()
    expect(selectArchiveEntry(`${top}/README.txt`)).toBeNull()
    expect(selectArchiveEntry(`${top}/doc/ffmpeg.html`)).toBeNull()
    expect(selectArchiveEntry(`${top}/presets/libvpx-720p.ffpreset`)).toBeNull()
    expect(selectArchiveEntry(`${top}/bin/`)).toBeNull()
  })

  it('nunca devolve caminhos com diretórios (sem zip-slip)', () => {
    for (const hostile of [
      '../bin/ffmpeg.exe',
      'x/bin/../evil.dll',
      'x/bin/sub/evil.dll',
      '/etc/passwd'
    ]) {
      const name = selectArchiveEntry(hostile)
      expect(name === null || !/[\\/]/.test(name)).toBe(true)
    }
    expect(selectArchiveEntry(`${top}/bin/../../evil.dll`)).toBeNull()
    expect(selectArchiveEntry(`${top}\\bin\\ffmpeg.exe`)).toBe('ffmpeg.exe')
  })
})
