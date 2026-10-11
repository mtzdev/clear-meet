import { describe, expect, it } from 'vitest'
import { levelToFraction, smoothLevel } from './audio-level'

describe('levelToFraction', () => {
  it('mapeia dBFS para 0..1', () => {
    expect(levelToFraction(0)).toBe(0)
    expect(levelToFraction(1)).toBe(1)
    expect(levelToFraction(2)).toBe(1)
    expect(levelToFraction(0.001)).toBeCloseTo(0, 6)
    expect(levelToFraction(0.01)).toBeCloseTo(1 / 3, 6)
    expect(levelToFraction(0.0001)).toBe(0)
    expect(levelToFraction(0.5)).toBeCloseTo((20 * Math.log10(0.5) + 60) / 60, 6)
  })
})

describe('smoothLevel', () => {
  it('sobe na hora e desce devagar', () => {
    expect(smoothLevel(0.2, 0.8, 100)).toBe(0.8)
    expect(smoothLevel(0.8, 0.1, 100)).toBeCloseTo(0.65)
    expect(smoothLevel(0.05, 0.02, 1000)).toBe(0.02)
  })
})
