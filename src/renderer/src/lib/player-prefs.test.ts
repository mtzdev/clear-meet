import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFS,
  parsePositions,
  parsePrefs,
  RESUME_END_GUARD_MS,
  RESUME_MIN_MS,
  rememberPosition,
  resumeInstant
} from './player-prefs'

describe('parsePrefs', () => {
  it('lê volume e velocidade válidos', () => {
    expect(parsePrefs(JSON.stringify({ volume: 0.4, rate: 1.5 }))).toEqual({
      volume: 0.4,
      rate: 1.5
    })
  })

  it('descarta valores inválidos, campo a campo', () => {
    expect(parsePrefs(JSON.stringify({ volume: 7, rate: 5 }))).toEqual(DEFAULT_PREFS)
    expect(parsePrefs(JSON.stringify({ volume: 0, rate: 2 }))).toEqual({ volume: 1, rate: 2 })
    expect(parsePrefs(JSON.stringify({ volume: 'alto' }))).toEqual(DEFAULT_PREFS)
  })

  it('aceita todas as velocidades do player', () => {
    for (const rate of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3]) {
      expect(parsePrefs(JSON.stringify({ volume: 1, rate })).rate).toBe(rate)
    }
  })

  it('texto ausente ou corrompido vira o padrão', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('{')).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('42')).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('null')).toEqual(DEFAULT_PREFS)
  })
})

describe('posição por Reunião', () => {
  const DURATION = 60 * 60 * 1000

  it('guarda a posição e retoma nela', () => {
    const positions = rememberPosition({}, 'a', 90_000, DURATION, 1)
    expect(resumeInstant(positions, 'a', DURATION)).toBe(90_000)
    expect(resumeInstant(positions, 'b', DURATION)).toBeNull()
  })

  it('no começo, esquece (abre do início)', () => {
    const saved = rememberPosition({}, 'a', 90_000, DURATION, 1)
    expect(rememberPosition(saved, 'a', RESUME_MIN_MS - 1, DURATION, 2)).toEqual({})
  })

  it('perto do fim, esquece (já foi vista)', () => {
    const saved = rememberPosition({}, 'a', 90_000, DURATION, 1)
    const end = DURATION - RESUME_END_GUARD_MS
    expect(rememberPosition(saved, 'a', end, DURATION, 2)).toEqual({})
    expect(resumeInstant({ a: { ms: end, at: 1 } }, 'a', DURATION)).toBeNull()
  })

  it('sem duração conhecida não aplica a guarda do fim', () => {
    expect(rememberPosition({}, 'a', 90_000, 0, 1)).toEqual({ a: { ms: 90_000, at: 1 } })
    expect(resumeInstant({ a: { ms: 90_000, at: 1 } }, 'a', null)).toBe(90_000)
  })

  it('mantém só as mais recentes', () => {
    let positions = {}
    for (let index = 0; index < 205; index++) {
      positions = rememberPosition(positions, `m${index}`, 60_000, DURATION, index)
    }
    expect(Object.keys(positions)).toHaveLength(200)
    expect(positions).not.toHaveProperty('m0')
    expect(positions).toHaveProperty('m204')
  })

  it('lê o armazenado e ignora entradas inválidas', () => {
    const raw = JSON.stringify({
      ok: { ms: 10_000, at: 5 },
      negativo: { ms: -1, at: 5 },
      texto: { ms: '10', at: 5 },
      solto: 3
    })
    expect(parsePositions(raw)).toEqual({ ok: { ms: 10_000, at: 5 } })
    expect(parsePositions(null)).toEqual({})
    expect(parsePositions('[1]')).toEqual({})
    expect(parsePositions('lixo')).toEqual({})
  })
})
