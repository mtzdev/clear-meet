import { describe, expect, it } from 'vitest'
import {
  applySettingsPatch,
  DEFAULT_SETTINGS,
  parseSettings,
  SETTINGS_SCHEMA_VERSION,
  serializeSettings
} from './settings'

describe('parseSettings', () => {
  it('lixo ou ausência devolve os padrões (Compactação ligada, 1080p)', () => {
    for (const raw of [null, undefined, 'x', 42, [], {}]) {
      expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS)
    }
    expect(DEFAULT_SETTINGS.compaction).toBe(true)
    expect(DEFAULT_SETTINGS.quality).toBe('1080p')
  })

  it('o codificador de vídeo padrão é por software; "hardware" só se pedido', () => {
    expect(DEFAULT_SETTINGS.videoEncoder).toBe('software')
    expect(parseSettings({ videoEncoder: 'hardware' }).videoEncoder).toBe('hardware')
    expect(parseSettings({ videoEncoder: 'gpu' }).videoEncoder).toBe('software')
  })

  it('aceita valores válidos', () => {
    expect(
      parseSettings({
        meetingsDir: 'D:\\Reunioes',
        compaction: false,
        quality: '720p',
        videoEncoder: 'hardware',
        micDeviceId: 'abc'
      })
    ).toEqual({
      meetingsDir: 'D:\\Reunioes',
      compaction: false,
      quality: '720p',
      videoEncoder: 'hardware',
      micDeviceId: 'abc'
    })
  })

  it('um campo inválido volta ao padrão sem perder os outros', () => {
    expect(
      parseSettings({ meetingsDir: '', compaction: 'sim', quality: '4k', micDeviceId: 'abc' })
    ).toEqual({ ...DEFAULT_SETTINGS, micDeviceId: 'abc' })
  })
})

describe('applySettingsPatch', () => {
  it('altera qualidade e microfone, ignorando valores inválidos', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { quality: 'native', micDeviceId: 'xyz' })
    expect(next).toEqual({ ...DEFAULT_SETTINGS, quality: 'native', micDeviceId: 'xyz' })
    const ignored = applySettingsPatch(next, { quality: '8k' as never })
    expect(ignored.quality).toBe('native')
  })

  it('micDeviceId vazio volta ao padrão do sistema (null)', () => {
    const current = { ...DEFAULT_SETTINGS, micDeviceId: 'xyz' }
    expect(applySettingsPatch(current, { micDeviceId: '' }).micDeviceId).toBeNull()
    expect(applySettingsPatch(current, { micDeviceId: null }).micDeviceId).toBeNull()
  })

  it('não altera o objeto original', () => {
    const current = { ...DEFAULT_SETTINGS }
    applySettingsPatch(current, { quality: '720p' })
    expect(current.quality).toBe('1080p')
  })
})

describe('serializeSettings', () => {
  it('grava a versão do esquema e volta igual ao ler', () => {
    const text = serializeSettings({ ...DEFAULT_SETTINGS, quality: '720p' })
    const raw = JSON.parse(text) as { schemaVersion: number }
    expect(raw.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
    expect(parseSettings(raw)).toEqual({ ...DEFAULT_SETTINGS, quality: '720p' })
    expect(text.endsWith('\n')).toBe(true)
  })
})
