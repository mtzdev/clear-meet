import { describe, expect, it } from 'vitest'
import { clockPause, clockResume, clockStart } from './clock'
import type { MeetingNote } from './meeting'
import {
  DEFAULT_NOTE_LEAD_SECONDS,
  insertNote,
  MAX_NOTE_LENGTH,
  noteOffsetMs,
  normalizeNoteText,
  removeNote,
  replaceNoteText
} from './notes'

const T0 = 1_000_000

describe('noteOffsetMs', () => {
  it('é o Instante da primeira tecla menos o recuo (padrão 5 s)', () => {
    const clock = clockStart(T0)
    expect(DEFAULT_NOTE_LEAD_SECONDS).toBe(5)
    expect(noteOffsetMs(clock, T0 + 125_000, 5)).toBe(120_000)
    expect(noteOffsetMs(clock, T0 + 125_000, 0)).toBe(125_000)
    expect(noteOffsetMs(clock, T0 + 125_000, 12.5)).toBe(112_500)
  })

  it('nunca é negativo (anotar nos primeiros segundos)', () => {
    const clock = clockStart(T0)
    expect(noteOffsetMs(clock, T0 + 2_000, 5)).toBe(0)
    expect(noteOffsetMs(clock, T0 - 500, 5)).toBe(0)
  })

  it('não conta os períodos pausados e fica parado durante a pausa', () => {
    // 60 s gravados, pausa de 10 min, mais 30 s gravados.
    let clock = clockStart(T0)
    clock = clockPause(clock, T0 + 60_000)
    expect(noteOffsetMs(clock, T0 + 60_000, 5)).toBe(55_000)
    expect(noteOffsetMs(clock, T0 + 400_000, 5)).toBe(55_000) // pausado: parado
    clock = clockResume(clock, T0 + 660_000)
    expect(noteOffsetMs(clock, T0 + 690_000, 5)).toBe(85_000) // 60 + 30 - 5
  })

  it('recuo inválido é tratado como zero', () => {
    const clock = clockStart(T0)
    expect(noteOffsetMs(clock, T0 + 10_000, Number.NaN)).toBe(10_000)
    expect(noteOffsetMs(clock, T0 + 10_000, -3)).toBe(10_000)
  })
})

describe('normalizeNoteText', () => {
  it('apara as pontas, normaliza quebras de linha e mantém as internas', () => {
    expect(normalizeNoteText('  oi\r\ncomo vai\r\n\r\nbem \n')).toBe('oi\ncomo vai\n\nbem')
  })

  it('vazio, só espaços ou não-texto viram vazio', () => {
    expect(normalizeNoteText('')).toBe('')
    expect(normalizeNoteText(' \n\t ')).toBe('')
    expect(normalizeNoteText(42)).toBe('')
    expect(normalizeNoteText(undefined)).toBe('')
  })

  it('limita o tamanho', () => {
    expect(normalizeNoteText('a'.repeat(MAX_NOTE_LENGTH + 100))).toHaveLength(MAX_NOTE_LENGTH)
  })
})

describe('insertNote', () => {
  const note = (id: string, offsetMs: number): MeetingNote => ({
    id,
    offsetMs,
    text: id,
    createdAt: '2026-10-10T17:31:00.000Z'
  })

  it('mantém a lista ordenada por Instante, com empates na ordem de criação', () => {
    let notes: MeetingNote[] = []
    notes = insertNote(notes, note('a', 50_000))
    notes = insertNote(notes, note('b', 10_000))
    notes = insertNote(notes, note('c', 50_000))
    notes = insertNote(notes, note('d', 0))
    expect(notes.map((item) => item.id)).toEqual(['d', 'b', 'a', 'c'])
  })

  it('não altera a lista original', () => {
    const original = [note('a', 1)]
    insertNote(original, note('b', 0))
    expect(original).toHaveLength(1)
  })
})

describe('replaceNoteText / removeNote', () => {
  const notes: MeetingNote[] = [
    { id: 'a', offsetMs: 1000, text: 'um', createdAt: '2026-10-10T10:00:00.000Z' },
    { id: 'b', offsetMs: 2000, text: 'dois', createdAt: '2026-10-10T10:00:01.000Z' }
  ]

  it('troca só o texto da Anotação, sem mexer no Instante nem na lista original', () => {
    const result = replaceNoteText(notes, 'b', 'novo')
    expect(result).toEqual([notes[0], { ...notes[1], text: 'novo' }])
    expect(notes[1]?.text).toBe('dois')
  })

  it('remove a Anotação pedida', () => {
    expect(removeNote(notes, 'a')).toEqual([notes[1]])
    expect(notes).toHaveLength(2)
  })

  it('devolve null quando a Anotação não existe', () => {
    expect(replaceNoteText(notes, 'x', 'z')).toBeNull()
    expect(removeNote(notes, 'x')).toBeNull()
  })
})
