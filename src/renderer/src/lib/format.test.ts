import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration } from './format'

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
