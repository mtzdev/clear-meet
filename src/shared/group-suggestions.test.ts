import { describe, expect, it } from 'vitest'
import { namePrefix, suggestGroups, type SuggestionSubject } from './group-suggestions'

let counter = 0

function local(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString()
}

function subject(overrides: Partial<SuggestionSubject> = {}): SuggestionSubject {
  counter += 1
  return {
    id: `m${counter}`,
    name: `Reunião de 10/10 14:3${counter % 10}`,
    tags: [],
    sourceKind: 'screen',
    sourceName: null,
    // Cada Reunião cai num dia e horário diferentes, para o acaso não formar um horário recorrente.
    createdAt: new Date(2026, 9, 1 + counter, 0, counter * 53).toISOString(),
    ...overrides
  }
}

function many(
  count: number,
  make: (index: number) => Partial<SuggestionSubject>
): SuggestionSubject[] {
  return Array.from({ length: count }, (_, index) => subject(make(index)))
}

const NONE = { dismissed: [], groupNames: [] }

describe('namePrefix', () => {
  it('tira datas e horas do fim do nome', () => {
    expect(namePrefix('Daily 14 10 10 00')).toBe('Daily')
    expect(namePrefix('Daily 14/10')).toBe('Daily')
    expect(namePrefix('Weekly de Produto 2026-10-12')).toBe('Weekly de Produto')
    expect(namePrefix('Daily-2026')).toBe('Daily')
    expect(namePrefix('Sprint Review - 14/10 10:00')).toBe('Sprint Review')
  })

  it('nome sem números fica inteiro', () => {
    expect(namePrefix('Daily')).toBe('Daily')
    expect(namePrefix('Alinhamento semanal')).toBe('Alinhamento semanal')
  })

  it('ignora o que não identifica uma série', () => {
    expect(namePrefix('Reunião de 10/10 14:30')).toBeNull()
    expect(namePrefix('Reunião')).toBeNull()
    expect(namePrefix('1:1 com a Ana')).toBeNull()
    expect(namePrefix('Oi')).toBeNull()
    expect(namePrefix('uma frase muito longa demais para ser nome de série recorrente')).toBeNull()
  })
})

describe('suggestGroups', () => {
  it('sugere o prefixo de nome repetido, ignorando datas e horas', () => {
    const subjects = [
      ...many(4, (i) => ({ name: `Daily 1${i} 10 10 00` })),
      ...many(2, () => ({ name: 'Almoço com o time' }))
    ]
    const result = suggestGroups(subjects, NONE)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'name:daily',
      basis: 'name',
      name: 'Daily',
      count: 4,
      rules: { nameContains: 'Daily' }
    })
  })

  it('exige o mínimo de Reuniões (3 por padrão)', () => {
    const two = many(2, () => ({ name: 'Daily 14/10' }))
    expect(suggestGroups(two, NONE)).toEqual([])
    expect(suggestGroups(two, { ...NONE, min: 2 })).toHaveLength(1)
  })

  it('sugere por Tag', () => {
    const subjects = many(3, () => ({ tags: ['Cliente X'] }))
    const result = suggestGroups(subjects, NONE)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'tag:cliente x',
      basis: 'tag',
      name: 'Cliente X',
      count: 3,
      rules: { tag: 'Cliente X' }
    })
  })

  it('sugere pelo aplicativo, só de janelas', () => {
    const windows = many(3, () => ({ sourceKind: 'window', sourceName: 'Zoom Meeting' }))
    const screens = many(3, () => ({ sourceKind: 'screen', sourceName: 'Tela 1' }))
    const result = suggestGroups([...windows, ...screens], NONE)
    expect(result.map((item) => [item.basis, item.name])).toEqual([['source', 'Zoom Meeting']])
  })

  it('sugere o mesmo dia da semana e horário recorrente', () => {
    // Três terças às 14:00, 14:05 e 13:55; mais uma quinta à tarde que não conta.
    const tuesdays = [
      subject({ createdAt: local(2026, 10, 6, 14, 0) }),
      subject({ createdAt: local(2026, 10, 13, 14, 5) }),
      subject({ createdAt: local(2026, 10, 20, 13, 55) }),
      subject({ createdAt: local(2026, 10, 22, 14, 0) })
    ]
    const result = suggestGroups(tuesdays, NONE)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      basis: 'schedule',
      name: 'Terça às 14:00',
      count: 3,
      rules: { weekdays: [2], startFromMin: 13 * 60 + 40, startToMin: 14 * 60 + 20 }
    })
  })

  it('não repete a mesma ideia quando as séries se sobrepõem', () => {
    const subjects = many(4, (i) => ({
      name: `Daily 1${i}/10`,
      tags: ['Daily'],
      sourceKind: 'window',
      sourceName: 'Meet'
    }))
    const result = suggestGroups(subjects, NONE)
    expect(result.map((item) => item.basis)).toEqual(['name'])
  })

  it('não sugere o que foi dispensado nem o nome de um grupo que existe', () => {
    const subjects = many(3, () => ({ name: 'Daily 14/10' }))
    expect(suggestGroups(subjects, { ...NONE, dismissed: ['name:daily'] })).toEqual([])
    expect(suggestGroups(subjects, { ...NONE, groupNames: ['daily'] })).toEqual([])
  })

  it('ordena pelas séries maiores e limita a quantidade', () => {
    const subjects = [
      ...many(3, () => ({ name: 'Alfa 1' })),
      ...many(5, () => ({ name: 'Beta 1' })),
      ...many(4, () => ({ name: 'Gama 1' })),
      ...many(3, () => ({ name: 'Delta 1' })),
      ...many(3, () => ({ name: 'Epsilon 1' })),
      ...many(3, () => ({ name: 'Zeta 1' }))
    ]
    const result = suggestGroups(subjects, NONE)
    expect(result).toHaveLength(5)
    expect(result.map((item) => item.name).slice(0, 2)).toEqual(['Beta', 'Gama'])
  })
})
