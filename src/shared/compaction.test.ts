import { describe, expect, it } from 'vitest'
import { isCompactionMode, needsCompaction, parseCompactionMeta } from './compaction'
import { DEFAULT_SETTINGS, applySettingsPatch, parseSettings } from './settings'

describe('parseCompactionMeta', () => {
  it('lê o bloco completo', () => {
    expect(
      parseCompactionMeta({
        status: 'done',
        codec: 'av1',
        encoder: 'libsvtav1',
        originalBytes: 1000,
        finalBytes: 300,
        updatedAt: '2026-10-16T10:00:00.000Z'
      })
    ).toEqual({
      status: 'done',
      codec: 'av1',
      encoder: 'libsvtav1',
      originalBytes: 1000,
      finalBytes: 300,
      updatedAt: '2026-10-16T10:00:00.000Z'
    })
  })

  it('ausente ou inválido vira "sem Compactação registrada"', () => {
    expect(parseCompactionMeta(undefined)).toBeUndefined()
    expect(parseCompactionMeta(null)).toBeUndefined()
    expect(parseCompactionMeta('done')).toBeUndefined()
    expect(parseCompactionMeta({ status: 'quase' })).toBeUndefined()
  })

  it('descarta campos inválidos sem perder o estado', () => {
    const meta = parseCompactionMeta({
      status: 'error',
      error: 'falhou',
      originalBytes: -5,
      finalBytes: 'muito',
      encoder: ''
    })
    expect(meta).toMatchObject({ status: 'error', error: 'falhou' })
    expect(meta).not.toHaveProperty('originalBytes')
    expect(meta).not.toHaveProperty('finalBytes')
    expect(meta).not.toHaveProperty('encoder')
  })
})

describe('needsCompaction', () => {
  const updatedAt = '2026-10-16T10:00:00.000Z'

  it('Reunião sem registro, pendente ou interrompida entra na fila', () => {
    expect(needsCompaction(undefined)).toBe(true)
    expect(needsCompaction({ status: 'pending', updatedAt })).toBe(true)
    expect(needsCompaction({ status: 'running', updatedAt })).toBe(true)
  })

  it('concluída, mantida ou com erro não volta sozinha', () => {
    expect(needsCompaction({ status: 'done', updatedAt })).toBe(false)
    expect(needsCompaction({ status: 'kept-original', updatedAt })).toBe(false)
    expect(needsCompaction({ status: 'error', updatedAt })).toBe(false)
  })
})

describe('configurações da Compactação', () => {
  it('padrão: ligada, no modo velocidade', () => {
    expect(DEFAULT_SETTINGS.compaction).toBe(true)
    expect(DEFAULT_SETTINGS.compactionMode).toBe('speed')
  })

  it('o modo inválido volta ao padrão e o válido é lido', () => {
    expect(parseSettings({ compactionMode: 'quality' }).compactionMode).toBe('quality')
    expect(parseSettings({ compactionMode: 'turbo' }).compactionMode).toBe('speed')
    expect(isCompactionMode('speed')).toBe(true)
    expect(isCompactionMode('x')).toBe(false)
  })

  it('o patch liga, desliga e troca o modo, ignorando valores inválidos', () => {
    const off = applySettingsPatch(DEFAULT_SETTINGS, {
      compaction: false,
      compactionMode: 'quality'
    })
    expect(off).toMatchObject({ compaction: false, compactionMode: 'quality' })
    const same = applySettingsPatch(off, {
      compaction: 'sim' as unknown as boolean,
      compactionMode: 'x' as never
    })
    expect(same).toMatchObject({ compaction: false, compactionMode: 'quality' })
  })
})
