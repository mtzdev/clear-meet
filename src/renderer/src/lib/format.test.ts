import { describe, expect, it } from 'vitest'
import { formatBytes, formatDateTime, formatDuration } from './format'

describe('formatBytes', () => {
  it('usa a unidade adequada e vírgula decimal', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1,5 KB')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5,0 GB')
    expect(formatBytes(142 * 1024 ** 3)).toBe('142 GB')
  })
})

describe('formatDuration', () => {
  it('escreve a duração por extenso', () => {
    expect(formatDuration(0)).toBe('0 s')
    expect(formatDuration(65_000)).toBe('1 min 5 s')
    expect(formatDuration(3_725_000)).toBe('1 h 2 min')
    expect(formatDuration(-5)).toBe('0 s')
  })
})

describe('formatDateTime', () => {
  it('escreve dia/mês/ano e hora no formato brasileiro', () => {
    expect(formatDateTime('2026-10-11T23:34:14.203Z', 'UTC')).toBe('11/10/2026 23:34')
    expect(formatDateTime('2026-10-11T23:34:14.203Z', 'America/Sao_Paulo')).toBe('11/10/2026 20:34')
    expect(formatDateTime('2026-01-05T00:05:00.000Z', 'UTC')).toBe('05/01/2026 00:05')
  })

  it('data inválida vira texto vazio', () => {
    expect(formatDateTime('não é data')).toBe('')
  })
})
