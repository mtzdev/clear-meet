import { describe, expect, it } from 'vitest'
import { compareMeetingsNewestFirst, lockFor, type MeetingListItem } from './library'

function item(folder: string, createdAt: string): MeetingListItem {
  return {
    id: folder,
    folder,
    name: folder,
    createdAt,
    durationMs: 1000,
    status: 'ready',
    live: false,
    source: { kind: 'none', name: null },
    noteCount: 0
  }
}

describe('compareMeetingsNewestFirst', () => {
  it('ordena do mais recente para o mais antigo; empate pelo caminho', () => {
    const list = [
      item('b', '2026-10-10T10:00:00.000Z'),
      item('c', '2026-10-12T10:00:00.000Z'),
      item('a', '2026-10-10T10:00:00.000Z')
    ]
    expect(list.sort(compareMeetingsNewestFirst).map((entry) => entry.folder)).toEqual([
      'c',
      'a',
      'b'
    ])
  })
})

describe('lockFor', () => {
  it('só Reuniões prontas e fora de gravação são editáveis', () => {
    expect(lockFor('ready', false)).toBeNull()
    expect(lockFor('ready', true)).toBe('recording')
    expect(lockFor('recording', false)).toBe('recording')
    expect(lockFor('processing', false)).toBe('unfinished')
    expect(lockFor('unprocessed', false)).toBe('unfinished')
  })
})
