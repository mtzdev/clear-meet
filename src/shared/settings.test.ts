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
        micDeviceId: 'abc',
        systemAudio: false,
        noteShortcut: 'Ctrl+Alt+N',
        noteLeadSeconds: 8,
        barPosition: { x: 120.4, y: -30 }
      })
    ).toEqual({
      meetingsDir: 'D:\\Reunioes',
      compaction: false,
      compactionMode: 'speed',
      quality: '720p',
      videoEncoder: 'hardware',
      micDeviceId: 'abc',
      systemAudio: false,
      noteShortcut: 'Ctrl+Alt+N',
      noteLeadSeconds: 8,
      barPosition: { x: 120, y: -30 },
      transcriptionModel: 'gemini-3.5-flash-lite',
      groqTextModel: 'openai/gpt-oss-120b',
      geminiTextModel: 'gemini-3.5-flash-lite'
    })
  })

  it('áudio do sistema: ligado por padrão; só booleano é aceito', () => {
    expect(DEFAULT_SETTINGS.systemAudio).toBe(true)
    expect(parseSettings({ systemAudio: false }).systemAudio).toBe(false)
    expect(parseSettings({ systemAudio: 'no' }).systemAudio).toBe(true)
    expect(parseSettings({ micDeviceId: 'abc' }).systemAudio).toBe(true)
  })

  it('modelos de texto: aceita os conhecidos e volta ao padrão nos desconhecidos', () => {
    const chosen = parseSettings({
      groqTextModel: 'llama-3.3-70b-versatile',
      geminiTextModel: 'gemini-3.6-flash'
    })
    expect(chosen.groqTextModel).toBe('llama-3.3-70b-versatile')
    expect(chosen.geminiTextModel).toBe('gemini-3.6-flash')
    const unknown = parseSettings({ groqTextModel: 'inventado', geminiTextModel: 42 })
    expect(unknown.groqTextModel).toBe(DEFAULT_SETTINGS.groqTextModel)
    expect(unknown.geminiTextModel).toBe(DEFAULT_SETTINGS.geminiTextModel)
  })

  it('Anotações: atalho padrão Ctrl+Shift+Space, recuo de 5 s e barra no topo-centro', () => {
    expect(DEFAULT_SETTINGS.noteShortcut).toBe('Ctrl+Shift+Space')
    expect(DEFAULT_SETTINGS.noteLeadSeconds).toBe(5)
    expect(DEFAULT_SETTINGS.barPosition).toBeNull()
  })

  it('valores inválidos de Anotação e de posição da barra voltam ao padrão', () => {
    for (const noteLeadSeconds of [-1, 301, Number.NaN, '5', null]) {
      expect(parseSettings({ noteLeadSeconds }).noteLeadSeconds).toBe(5)
    }
    expect(parseSettings({ noteLeadSeconds: 0 }).noteLeadSeconds).toBe(0)
    for (const noteShortcut of ['', '   ', 42, null]) {
      expect(parseSettings({ noteShortcut }).noteShortcut).toBe('Ctrl+Shift+Space')
    }
    for (const barPosition of [{ x: 1 }, { x: '1', y: 2 }, [1, 2], 'a', { x: Infinity, y: 0 }]) {
      expect(parseSettings({ barPosition }).barPosition).toBeNull()
    }
  })

  it('um campo inválido volta ao padrão sem perder os outros', () => {
    expect(
      parseSettings({ meetingsDir: '', compaction: 'sim', quality: '4k', micDeviceId: 'abc' })
    ).toEqual({ ...DEFAULT_SETTINGS, micDeviceId: 'abc' })
  })
})

describe('applySettingsPatch', () => {
  it('troca os modelos de texto e ignora valores desconhecidos', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, {
      groqTextModel: 'llama-3.3-70b-versatile',
      geminiTextModel: 'gemini-3.6-flash'
    })
    expect(next.groqTextModel).toBe('llama-3.3-70b-versatile')
    expect(next.geminiTextModel).toBe('gemini-3.6-flash')
    const ignored = applySettingsPatch(next, { groqTextModel: 'x', geminiTextModel: 'y' })
    expect(ignored).toEqual(next)
  })

  it('altera qualidade e microfone, ignorando valores inválidos', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { quality: 'native', micDeviceId: 'xyz' })
    expect(next).toEqual({ ...DEFAULT_SETTINGS, quality: 'native', micDeviceId: 'xyz' })
    const ignored = applySettingsPatch(next, { quality: '8k' as never })
    expect(ignored.quality).toBe('native')
  })

  it('liga e desliga o áudio do sistema, ignorando valores que não são booleanos', () => {
    const off = applySettingsPatch(DEFAULT_SETTINGS, { systemAudio: false })
    expect(off).toEqual({ ...DEFAULT_SETTINGS, systemAudio: false })
    expect(applySettingsPatch(off, { systemAudio: 'sim' as never }).systemAudio).toBe(false)
    expect(applySettingsPatch(off, { systemAudio: true }).systemAudio).toBe(true)
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
