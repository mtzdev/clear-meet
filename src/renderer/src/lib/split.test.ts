import { describe, expect, it } from 'vitest'
import {
  clampSplit,
  DEFAULT_SPLIT,
  DIVIDER_PX,
  isStacked,
  MIN_PANEL_PX,
  MIN_PLAYER_PX,
  parseStoredSplit,
  splitFromPointer,
  STACK_BELOW_PX
} from './split'

describe('isStacked', () => {
  it('empilha só abaixo do limite de largura', () => {
    expect(isStacked(STACK_BELOW_PX - 1)).toBe(true)
    expect(isStacked(STACK_BELOW_PX)).toBe(false)
    expect(isStacked(1056)).toBe(false)
    expect(isStacked(756)).toBe(true)
  })
})

describe('clampSplit', () => {
  const total = 1056
  const usable = total - DIVIDER_PX

  it('deixa passar proporções que respeitam os mínimos', () => {
    expect(clampSplit(0.6, total)).toBe(0.6)
    expect(clampSplit(0.5, total)).toBe(0.5)
  })

  it('o player nunca fica menor que o mínimo nem o painel menor que o dele', () => {
    expect(clampSplit(0.01, total) * usable).toBeCloseTo(MIN_PLAYER_PX)
    expect((1 - clampSplit(0.99, total)) * usable).toBeCloseTo(MIN_PANEL_PX)
  })

  it('valores inválidos ou área pequena demais voltam ao padrão', () => {
    expect(clampSplit(Number.NaN, total)).toBe(DEFAULT_SPLIT)
    expect(clampSplit(0.5, 500)).toBe(DEFAULT_SPLIT)
    expect(clampSplit(0.5, 0)).toBe(DEFAULT_SPLIT)
  })
})

describe('splitFromPointer', () => {
  it('converte a posição do ponteiro em proporção, dentro dos limites', () => {
    const total = 1008
    // O centro do divisor fica na posição do ponteiro.
    expect(splitFromPointer(600 + DIVIDER_PX / 2, total)).toBeCloseTo(0.6)
    expect(splitFromPointer(0, total) * (total - DIVIDER_PX)).toBeCloseTo(MIN_PLAYER_PX)
    expect(splitFromPointer(99999, total)).toBeLessThan(1)
    expect(splitFromPointer(100, 0)).toBe(DEFAULT_SPLIT)
  })
})

describe('parseStoredSplit', () => {
  it('aceita só números entre 0 e 1', () => {
    expect(parseStoredSplit('0.55')).toBe(0.55)
    expect(parseStoredSplit(null)).toBeNull()
    expect(parseStoredSplit('')).toBeNull()
    expect(parseStoredSplit('abc')).toBeNull()
    expect(parseStoredSplit('0')).toBeNull()
    expect(parseStoredSplit('1')).toBeNull()
    expect(parseStoredSplit('7')).toBeNull()
  })
})
