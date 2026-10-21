import { describe, expect, it } from 'vitest'
import {
  checkGroupName,
  cleanGroupInput,
  describeRules,
  EMPTY_RULES,
  firstMatchingGroup,
  groupNameTaken,
  matchesRules,
  parseGroupId,
  parseGroupsFile,
  parseRules,
  reorderGroups,
  rulesProblem,
  serializeGroupsFile,
  textKey,
  type GroupDef,
  type GroupRules,
  type RuleSubject
} from './groups'

function rules(overrides: Partial<GroupRules>): GroupRules {
  return { ...EMPTY_RULES, ...overrides }
}

/** Data e hora local (como o usuário vê a Reunião), em ISO. */
function local(year: number, month: number, day: number, hour = 0, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString()
}

function subject(overrides: Partial<RuleSubject> = {}): RuleSubject {
  return {
    name: 'Daily 14 10 10 00',
    tags: [],
    sourceName: 'Google Meet - Daily',
    // Segunda-feira, 12/10/2026, 10:00.
    createdAt: local(2026, 10, 12, 10, 0),
    ...overrides
  }
}

function group(id: string, name: string, groupRules: GroupRules | null = null): GroupDef {
  return { id, name, description: '', createdAt: '2026-10-01T00:00:00.000Z', rules: groupRules }
}

describe('texto', () => {
  it('compara sem maiúsculas, acentos nem espaços repetidos', () => {
    expect(textKey('  Reunião   DIÁRIA ')).toBe('reuniao diaria')
  })

  it('valida o nome do grupo', () => {
    expect(checkGroupName('  Daily   do time ')).toEqual({ ok: true, value: 'Daily do time' })
    expect(checkGroupName('   ').ok).toBe(false)
    expect(checkGroupName(42).ok).toBe(false)
    expect(checkGroupName('x'.repeat(61)).ok).toBe(false)
    expect(checkGroupName('x'.repeat(60)).ok).toBe(true)
  })

  it('nome repetido não diferencia maiúsculas e acentos, e ignora o próprio grupo', () => {
    const groups = [group('a', 'Reunião Diária'), group('b', 'Semanal')]
    expect(groupNameTaken(groups, 'reuniao diaria')).toBe(true)
    expect(groupNameTaken(groups, 'reuniao diaria', 'a')).toBe(false)
    expect(groupNameTaken(groups, 'Mensal')).toBe(false)
  })
})

describe('parseRules', () => {
  it('sem condição nenhuma não é regra', () => {
    expect(parseRules(null)).toBeNull()
    expect(parseRules('x')).toBeNull()
    expect(parseRules({})).toBeNull()
    expect(parseRules({ nameContains: '   ', weekdays: [] })).toBeNull()
  })

  it('descarta o que é inválido e mantém o resto', () => {
    expect(
      parseRules({
        tag: ' Daily ',
        nameContains: 42,
        weekdays: [3, 1, 3, 9, -1, 'x'],
        startFromMin: 600,
        startToMin: 2000,
        fromDate: '2026-10-01',
        toDate: '2026-02-31'
      })
    ).toEqual(
      rules({
        tag: 'Daily',
        weekdays: [1, 3],
        startFromMin: 600,
        fromDate: '2026-10-01'
      })
    )
  })

  it('aponta horário e período invertidos', () => {
    expect(rulesProblem(rules({ startFromMin: 700, startToMin: 600 }))).toMatch(/horário/)
    expect(rulesProblem(rules({ fromDate: '2026-10-10', toDate: '2026-10-01' }))).toMatch(/data/)
    expect(rulesProblem(rules({ startFromMin: 600, startToMin: 600 }))).toBeNull()
  })
})

describe('matchesRules', () => {
  it('regras vazias não pegam nada', () => {
    expect(matchesRules(EMPTY_RULES, subject())).toBe(false)
  })

  it('Tag é X', () => {
    expect(matchesRules(rules({ tag: 'daily' }), subject({ tags: ['Daily'] }))).toBe(true)
    expect(matchesRules(rules({ tag: 'Diária' }), subject({ tags: ['diaria'] }))).toBe(true)
    expect(matchesRules(rules({ tag: 'Daily' }), subject({ tags: ['Weekly'] }))).toBe(false)
  })

  it('nome contém, sem acentos nem maiúsculas', () => {
    expect(matchesRules(rules({ nameContains: 'DAILY' }), subject())).toBe(true)
    expect(
      matchesRules(rules({ nameContains: 'reuniao' }), subject({ name: 'Reunião geral' }))
    ).toBe(true)
    expect(matchesRules(rules({ nameContains: 'weekly' }), subject())).toBe(false)
  })

  it('app ou Fonte contém usa o nome da Fonte gravada', () => {
    expect(matchesRules(rules({ sourceContains: 'google meet' }), subject())).toBe(true)
    expect(matchesRules(rules({ sourceContains: 'zoom' }), subject())).toBe(false)
    expect(matchesRules(rules({ sourceContains: 'meet' }), subject({ sourceName: null }))).toBe(
      false
    )
  })

  it('dia da semana (0 = domingo)', () => {
    expect(matchesRules(rules({ weekdays: [1, 3] }), subject())).toBe(true)
    expect(matchesRules(rules({ weekdays: [2, 4] }), subject())).toBe(false)
  })

  it('faixa de horário de início, nas pontas inclusive', () => {
    const at = (hour: number, minute: number): RuleSubject =>
      subject({ createdAt: local(2026, 10, 12, hour, minute) })
    const window = rules({ startFromMin: 9 * 60, startToMin: 10 * 60 })
    expect(matchesRules(window, at(9, 0))).toBe(true)
    expect(matchesRules(window, at(10, 0))).toBe(true)
    expect(matchesRules(window, at(8, 59))).toBe(false)
    expect(matchesRules(window, at(10, 1))).toBe(false)
    expect(matchesRules(rules({ startFromMin: 14 * 60 }), at(15, 0))).toBe(true)
    expect(matchesRules(rules({ startToMin: 8 * 60 }), at(15, 0))).toBe(false)
  })

  it('período, nas pontas inclusive', () => {
    const period = rules({ fromDate: '2026-10-12', toDate: '2026-10-14' })
    expect(matchesRules(period, subject({ createdAt: local(2026, 10, 12, 0, 5) }))).toBe(true)
    expect(matchesRules(period, subject({ createdAt: local(2026, 10, 14, 23, 59) }))).toBe(true)
    expect(matchesRules(period, subject({ createdAt: local(2026, 10, 11, 23, 59) }))).toBe(false)
    expect(matchesRules(period, subject({ createdAt: local(2026, 10, 15, 0, 0) }))).toBe(false)
  })

  it('combina tudo com E', () => {
    const all = rules({ tag: 'Daily', nameContains: 'daily', weekdays: [1], startFromMin: 540 })
    expect(matchesRules(all, subject({ tags: ['Daily'] }))).toBe(true)
    expect(matchesRules(all, subject({ tags: [] }))).toBe(false)
    expect(
      matchesRules(all, subject({ tags: ['Daily'], createdAt: local(2026, 10, 13, 10, 0) }))
    ).toBe(false)
  })

  it('data inválida nunca combina com regras de tempo', () => {
    expect(matchesRules(rules({ weekdays: [1] }), subject({ createdAt: 'ontem' }))).toBe(false)
    expect(matchesRules(rules({ nameContains: 'daily' }), subject({ createdAt: 'ontem' }))).toBe(
      true
    )
  })
})

describe('prioridade', () => {
  it('vale o primeiro grupo automático que combina, na ordem da lista', () => {
    const groups = [
      group('manual', 'Manual'),
      group('a', 'Dailies', rules({ nameContains: 'daily' })),
      group('b', 'Tudo de segunda', rules({ weekdays: [1] }))
    ]
    expect(firstMatchingGroup(groups, subject())?.id).toBe('a')
    expect(firstMatchingGroup([...groups].reverse(), subject())?.id).toBe('b')
    expect(
      firstMatchingGroup(groups, subject({ name: 'Outra', createdAt: local(2026, 10, 13) }))
    ).toBe(null)
  })

  it('reordena e mantém no fim o que ficou de fora', () => {
    const groups = [group('a', 'A'), group('b', 'B'), group('c', 'C')]
    expect(reorderGroups(groups, ['c', 'a']).map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(reorderGroups(groups, ['x', 'b', 'b']).map((item) => item.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('descrição das regras', () => {
  it('escreve cada condição em uma frase curta', () => {
    expect(
      describeRules(
        rules({
          tag: 'Daily',
          nameContains: 'x',
          sourceContains: 'Meet',
          weekdays: [0, 3, 1],
          startFromMin: 540,
          startToMin: 600,
          fromDate: '2026-10-01',
          toDate: '2026-10-31'
        })
      )
    ).toEqual([
      'Tag [Daily]',
      'Nome contém “x”',
      'Fonte contém “Meet”',
      'seg, qua, dom',
      'Início entre 09:00 e 10:00',
      'De 01/10/2026 a 31/10/2026'
    ])
    expect(describeRules(rules({ startFromMin: 540 }))).toEqual(['Início a partir de 09:00'])
  })
})

describe('pedido de criar ou editar', () => {
  it('aceita grupo manual e limpa os textos', () => {
    expect(
      cleanGroupInput({ name: '  Daily  ', description: ' time  todo ', rules: null })
    ).toEqual({ ok: true, value: { name: 'Daily', description: 'time todo', rules: null } })
  })

  it('recusa nome vazio, regras vazias e intervalos invertidos', () => {
    expect(cleanGroupInput({ name: '', rules: null }).ok).toBe(false)
    expect(cleanGroupInput(null).ok).toBe(false)
    const empty = cleanGroupInput({ name: 'A', rules: {} })
    expect(empty.ok).toBe(false)
    const inverted = cleanGroupInput({
      name: 'A',
      rules: { startFromMin: 700, startToMin: 600 }
    })
    expect(inverted.ok).toBe(false)
  })

  it('aceita grupo automático', () => {
    const result = cleanGroupInput({ name: 'A', rules: { tag: 'Daily' } })
    expect(result).toEqual({
      ok: true,
      value: { name: 'A', description: '', rules: rules({ tag: 'Daily' }) }
    })
  })
})

describe('groups.json', () => {
  it('lê de forma tolerante: ignora grupos inválidos e repetidos', () => {
    const file = parseGroupsFile({
      groups: [
        { id: 'a', name: 'Daily', rules: { tag: 'Daily' }, createdAt: '2026-10-01T00:00:00Z' },
        { id: 'a', name: 'Repetido' },
        { id: '', name: 'Sem id' },
        { id: 'b', name: '   ' },
        { id: 'c', name: 'Manual', description: 42, rules: {} },
        'lixo',
        null
      ],
      dismissed: ['name:daily', 'name:daily', '', 3]
    })
    expect(file.groups.map((item) => [item.id, item.name])).toEqual([
      ['a', 'Daily'],
      ['c', 'Manual']
    ])
    expect(file.groups[0]?.rules).toEqual(rules({ tag: 'Daily' }))
    expect(file.groups[1]).toMatchObject({ description: '', rules: null })
    expect(file.dismissed).toEqual(['name:daily'])
  })

  it('arquivo que não é objeto vira vazio', () => {
    expect(parseGroupsFile(null)).toEqual({ groups: [], dismissed: [] })
    expect(parseGroupsFile([])).toEqual({ groups: [], dismissed: [] })
    expect(parseGroupsFile({ groups: 'x' })).toEqual({ groups: [], dismissed: [] })
  })

  it('vai e volta pelo texto', () => {
    const file = {
      groups: [group('a', 'Daily', rules({ tag: 'Daily', weekdays: [1] }))],
      dismissed: ['tag:x']
    }
    const text = serializeGroupsFile(file)
    expect(text.endsWith('\n')).toBe(true)
    expect(parseGroupsFile(JSON.parse(text))).toEqual(file)
  })

  it('lê o groupId do meeting.json', () => {
    expect(parseGroupId('abc')).toBe('abc')
    expect(parseGroupId('')).toBeNull()
    expect(parseGroupId(3)).toBeNull()
    expect(parseGroupId('x'.repeat(101))).toBeNull()
  })
})
