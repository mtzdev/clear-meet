import { describe, expect, it } from 'vitest'
import type { MeetingNote } from './meeting'
import {
  clampInstant,
  currentNoteId,
  formatInstant,
  instantAtPosition,
  markerPosition,
  seekBy,
  SEEK_STEP_MS,
  timelineDurationMs
} from './timeline'

function note(id: string, offsetMs: number): MeetingNote {
  return { id, offsetMs, text: id, createdAt: '2026-10-10T10:00:00.000Z' }
}

describe('formatInstant', () => {
  it('usa mm:ss abaixo de 1 hora', () => {
    expect(formatInstant(0)).toBe('00:00')
    expect(formatInstant(5_000)).toBe('00:05')
    expect(formatInstant(65_000)).toBe('01:05')
    expect(formatInstant(599_999)).toBe('09:59')
    expect(formatInstant(3_599_000)).toBe('59:59')
  })

  it('usa h:mm:ss a partir de 1 hora', () => {
    expect(formatInstant(3_600_000)).toBe('1:00:00')
    expect(formatInstant(3_725_000)).toBe('1:02:05')
    expect(formatInstant(36_000_000)).toBe('10:00:00')
  })

  it('arredonda para baixo e tolera valores inválidos', () => {
    expect(formatInstant(1_999)).toBe('00:01')
    expect(formatInstant(-1_000)).toBe('00:00')
    expect(formatInstant(Number.NaN)).toBe('00:00')
    expect(formatInstant(Number.POSITIVE_INFINITY)).toBe('00:00')
  })
})

describe('markerPosition', () => {
  it('é Instante / duração, entre 0 e 1', () => {
    expect(markerPosition(0, 60_000)).toBe(0)
    expect(markerPosition(15_000, 60_000)).toBe(0.25)
    expect(markerPosition(60_000, 60_000)).toBe(1)
  })

  it('mantém marcadores fora da duração dentro da linha do tempo', () => {
    expect(markerPosition(90_000, 60_000)).toBe(1)
    expect(markerPosition(-5, 60_000)).toBe(0)
  })

  it('sem duração conhecida, o marcador fica no início', () => {
    expect(markerPosition(10_000, 0)).toBe(0)
    expect(markerPosition(10_000, Number.NaN)).toBe(0)
    expect(markerPosition(Number.NaN, 60_000)).toBe(0)
  })
})

describe('instantAtPosition', () => {
  it('converte a posição na linha do tempo em Instante', () => {
    expect(instantAtPosition(0.5, 120_000)).toBe(60_000)
    expect(instantAtPosition(1.5, 120_000)).toBe(120_000)
    expect(instantAtPosition(-1, 120_000)).toBe(0)
    expect(instantAtPosition(0.5, 0)).toBe(0)
  })
})

describe('seekBy / clampInstant', () => {
  it('salta 5 s para os dois lados sem sair da Reunião', () => {
    expect(SEEK_STEP_MS).toBe(5000)
    expect(seekBy(20_000, SEEK_STEP_MS, 60_000)).toBe(25_000)
    expect(seekBy(20_000, -SEEK_STEP_MS, 60_000)).toBe(15_000)
    expect(seekBy(2_000, -SEEK_STEP_MS, 60_000)).toBe(0)
    expect(seekBy(58_000, SEEK_STEP_MS, 60_000)).toBe(60_000)
  })

  it('sem duração conhecida só impede o negativo', () => {
    expect(clampInstant(9_999_999, 0)).toBe(9_999_999)
    expect(clampInstant(-3, 0)).toBe(0)
    expect(clampInstant(Number.NaN, 10)).toBe(0)
  })
})

describe('timelineDurationMs', () => {
  it('prefere a duração do arquivo de mídia; senão a do meeting.json', () => {
    expect(timelineDurationMs(49.08, 49_076)).toBe(49_080)
    expect(timelineDurationMs(Number.NaN, 49_076)).toBe(49_076)
    expect(timelineDurationMs(Number.POSITIVE_INFINITY, 49_076)).toBe(49_076)
    expect(timelineDurationMs(0, 49_076)).toBe(49_076)
    expect(timelineDurationMs(Number.NaN, null)).toBe(0)
  })
})

describe('currentNoteId', () => {
  const notes = [note('a', 10_000), note('b', 20_000), note('c', 20_000), note('d', 40_000)]

  it('é a última Anotação cujo Instante já passou', () => {
    expect(currentNoteId(notes, 0)).toBeNull()
    expect(currentNoteId(notes, 9_999)).toBeNull()
    expect(currentNoteId(notes, 10_000)).toBe('a')
    expect(currentNoteId(notes, 25_000)).toBe('c')
    expect(currentNoteId(notes, 99_000)).toBe('d')
    expect(currentNoteId([], 5_000)).toBeNull()
  })
})
