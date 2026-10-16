import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRANSCRIPTION_MODEL,
  isAiProvider,
  isTranscriptionModel,
  normalizeApiKey,
  transcriptionEngine,
  TRANSCRIPTION_MODELS
} from './ai'
import { applySettingsPatch, DEFAULT_SETTINGS, parseSettings } from './settings'

describe('normalizeApiKey', () => {
  it('apara as pontas e recusa vazio, espaço no meio e tamanhos absurdos', () => {
    expect(normalizeApiKey('  AIzaSyA-1234567890abcdef  ')).toBe('AIzaSyA-1234567890abcdef')
    expect(normalizeApiKey('')).toBeNull()
    expect(normalizeApiKey('curta')).toBeNull()
    expect(normalizeApiKey('AIzaSyA 1234567890abcdef')).toBeNull()
    expect(normalizeApiKey('a'.repeat(300))).toBeNull()
    expect(normalizeApiKey(42)).toBeNull()
  })
})

describe('modelos e provedores', () => {
  it('o primeiro modelo é o padrão e só os listados valem', () => {
    expect(TRANSCRIPTION_MODELS[0]?.id).toBe(DEFAULT_TRANSCRIPTION_MODEL)
    expect(isTranscriptionModel('gemini-3.6-flash')).toBe(true)
    expect(isTranscriptionModel('gpt-4')).toBe(false)
    expect(isAiProvider('groq')).toBe(true)
    expect(isAiProvider('openai')).toBe(false)
  })

  it('cada modelo declara o motor; o dedicado não é o padrão e desconhecido cai no geral', () => {
    expect(transcriptionEngine('gemini-3.5-transcribe')).toBe('transcribe')
    expect(isTranscriptionModel('gemini-3.5-transcribe')).toBe(true)
    expect(DEFAULT_TRANSCRIPTION_MODEL).not.toBe('gemini-3.5-transcribe')
    expect(transcriptionEngine(DEFAULT_TRANSCRIPTION_MODEL)).toBe('generate')
    expect(transcriptionEngine('desconhecido')).toBe('generate')
  })

  it('a configuração do modelo é validada ao ler e ao aplicar um patch', () => {
    expect(DEFAULT_SETTINGS.transcriptionModel).toBe(DEFAULT_TRANSCRIPTION_MODEL)
    expect(parseSettings({ transcriptionModel: 'gemini-3.6-flash' }).transcriptionModel).toBe(
      'gemini-3.6-flash'
    )
    expect(parseSettings({ transcriptionModel: 'qualquer' }).transcriptionModel).toBe(
      DEFAULT_TRANSCRIPTION_MODEL
    )
    expect(
      applySettingsPatch(DEFAULT_SETTINGS, { transcriptionModel: 'gemini-3.6-flash' })
        .transcriptionModel
    ).toBe('gemini-3.6-flash')
    expect(
      applySettingsPatch(DEFAULT_SETTINGS, { transcriptionModel: 'inventado' }).transcriptionModel
    ).toBe(DEFAULT_TRANSCRIPTION_MODEL)
  })
})
