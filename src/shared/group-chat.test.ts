import { describe, expect, it } from 'vitest'
import {
  assignLabels,
  autoSelection,
  DEFAULT_SCOPE,
  MAX_SCOPE_MEETINGS,
  parseGroupChat,
  parseScope,
  resolveScope,
  listScopeMeetings,
  scopeSummaryText,
  setMeetingIncluded,
  type GroupScope,
  type ScopeCandidate
} from './group-chat'

const NOW = Date.parse('2026-10-21T15:00:00.000Z')
const DAY = 86_400_000

function meeting(id: string, daysAgo: number, hasTranscript = true): ScopeCandidate {
  return {
    id,
    name: `Reunião ${id}`,
    createdAt: new Date(NOW - daysAgo * DAY).toISOString(),
    durationMs: 600_000,
    hasTranscript
  }
}

const scope = (overrides: Partial<GroupScope> = {}): GroupScope => ({
  ...DEFAULT_SCOPE,
  include: [],
  exclude: [],
  ...overrides
})

const ids = (list: readonly ScopeCandidate[]): string[] => list.map((item) => item.id)

describe('parseScope', () => {
  it('usa o padrão para o que não é válido', () => {
    expect(parseScope(null)).toEqual({ periodDays: 30, maxMeetings: 5, include: [], exclude: [] })
    expect(parseScope({ periodDays: 45, maxMeetings: 7 })).toMatchObject({
      periodDays: 30,
      maxMeetings: 5
    })
  })

  it('aceita as opções oferecidas e "tudo" (null)', () => {
    expect(parseScope({ periodDays: null, maxMeetings: 12 })).toMatchObject({
      periodDays: null,
      maxMeetings: 12
    })
    expect(parseScope({ periodDays: 7, maxMeetings: 3 })).toMatchObject({
      periodDays: 7,
      maxMeetings: 3
    })
  })

  it('limpa as marcações: só textos, sem repetir, e excluir vence incluir', () => {
    const parsed = parseScope({ include: ['a', 'a', 'b', 3, ''], exclude: ['b', 'c'] })
    expect(parsed.include).toEqual(['a'])
    expect(parsed.exclude).toEqual(['b', 'c'])
  })
})

describe('resolveScope', () => {
  const group = [
    meeting('a', 1),
    meeting('b', 3),
    meeting('c', 6),
    meeting('d', 10),
    meeting('e', 40),
    meeting('f', 100)
  ]

  it('pega as mais recentes do período, até o máximo', () => {
    const result = resolveScope(group, scope({ periodDays: 30, maxMeetings: 3 }), NOW)
    expect(ids(result.selected)).toEqual(['a', 'b', 'c'])
    expect(result.missing).toEqual([])
    expect(result.capped).toBe(false)
  })

  it('o período corta mesmo que sobrem vagas no máximo', () => {
    expect(
      ids(resolveScope(group, scope({ periodDays: 7, maxMeetings: 10 }), NOW).selected)
    ).toEqual(['a', 'b', 'c'])
    expect(
      ids(resolveScope(group, scope({ periodDays: 90, maxMeetings: 10 }), NOW).selected)
    ).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('"tudo" não tem limite de tempo', () => {
    expect(
      ids(resolveScope(group, scope({ periodDays: null, maxMeetings: 10 }), NOW).selected)
    ).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('ignora a ordem da lista recebida', () => {
    const shuffled = [group[3], group[0], group[5], group[1]] as ScopeCandidate[]
    expect(
      ids(resolveScope(shuffled, scope({ periodDays: null, maxMeetings: 3 }), NOW).selected)
    ).toEqual(['a', 'b', 'd'])
  })

  it('marcações manuais: desmarcar tira, marcar põe uma de fora do período', () => {
    const result = resolveScope(
      group,
      scope({ periodDays: 7, maxMeetings: 3, exclude: ['b'], include: ['f'] }),
      NOW
    )
    expect(ids(result.selected)).toEqual(['a', 'c', 'f'])
  })

  it('Reunião sem Transcrição fica de fora e vira aviso, sem completar a vaga', () => {
    const list = [meeting('a', 1), meeting('b', 2, false), meeting('c', 3), meeting('d', 4)]
    const result = resolveScope(list, scope({ maxMeetings: 3 }), NOW)
    expect(ids(result.selected)).toEqual(['a', 'c'])
    expect(ids(result.missing)).toEqual(['b'])
    expect(ids(result.chosen)).toEqual(['a', 'b', 'c'])
  })

  it('o teto absoluto de 12 Reuniões vale mesmo com marcações manuais', () => {
    const many = Array.from({ length: 30 }, (_, index) => meeting(`m${index}`, index + 1))
    const result = resolveScope(
      many,
      scope({
        periodDays: 7,
        maxMeetings: 5,
        include: many.slice(5, 29).map((item) => item.id)
      }),
      NOW
    )
    expect(result.chosen).toHaveLength(MAX_SCOPE_MEETINGS)
    expect(result.capped).toBe(true)
    expect(result.chosen[0]?.id).toBe('m0')
  })

  it('grupo vazio não escolhe nada', () => {
    expect(resolveScope([], scope(), NOW).chosen).toEqual([])
  })
})

describe('setMeetingIncluded', () => {
  const group = [meeting('a', 1), meeting('b', 2), meeting('c', 3), meeting('d', 50)]
  const base = scope({ periodDays: 30, maxMeetings: 2 })

  it('só guarda o que difere da escolha automática', () => {
    expect(setMeetingIncluded(base, group, NOW, 'a', true)).toEqual(base)
    expect(setMeetingIncluded(base, group, NOW, 'c', false)).toEqual(base)
  })

  it('desmarcar uma automática exclui; marcar uma de fora inclui', () => {
    const excluded = setMeetingIncluded(base, group, NOW, 'a', false)
    expect(excluded.exclude).toEqual(['a'])
    const included = setMeetingIncluded(excluded, group, NOW, 'd', true)
    expect(included.include).toEqual(['d'])
    expect(ids(resolveScope(group, included, NOW).selected)).toEqual(['b', 'd'])
  })

  it('voltar atrás remove a marcação', () => {
    const excluded = setMeetingIncluded(base, group, NOW, 'a', false)
    expect(setMeetingIncluded(excluded, group, NOW, 'a', true).exclude).toEqual([])
  })

  it('autoSelection não considera as marcações', () => {
    expect(ids(autoSelection(group, scope({ ...base, exclude: ['a'] }), NOW))).toEqual(['a', 'b'])
  })
})

describe('listScopeMeetings', () => {
  const group = [
    meeting('a', 1),
    meeting('b', 3),
    meeting('c', 6),
    meeting('d', 40),
    meeting('e', 60)
  ]

  it('escolhidas primeiro, depois as do período, e as anteriores ao período à parte', () => {
    const current = scope({ periodDays: 30, maxMeetings: 2, exclude: ['a'], include: ['e'] })
    const listing = listScopeMeetings(group, current, resolveScope(group, current, NOW), NOW)
    expect(ids(listing.main)).toEqual(['b', 'e', 'a', 'c'])
    expect(ids(listing.older)).toEqual(['d'])
  })

  it('"tudo" não separa Reuniões antigas', () => {
    const current = scope({ periodDays: null, maxMeetings: 3 })
    const listing = listScopeMeetings(group, current, resolveScope(group, current, NOW), NOW)
    expect(ids(listing.main)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(listing.older).toEqual([])
  })
})

describe('scopeSummaryText', () => {
  it('mostra quantidade e intervalo de datas', () => {
    const list = [
      { ...meeting('a', 0), createdAt: new Date(2026, 9, 21, 10).toISOString() },
      { ...meeting('b', 0), createdAt: new Date(2026, 9, 14, 10).toISOString() },
      { ...meeting('c', 0), createdAt: new Date(2026, 9, 17, 10).toISOString() }
    ]
    expect(scopeSummaryText(list)).toBe('3 Reuniões · 14/10 a 21/10')
  })

  it('uma Reunião, ou todas no mesmo dia, mostram a data uma vez', () => {
    const one = { ...meeting('a', 0), createdAt: new Date(2026, 9, 21, 10).toISOString() }
    expect(scopeSummaryText([one])).toBe('1 Reunião · 21/10')
    const same = { ...one, id: 'b', createdAt: new Date(2026, 9, 21, 16).toISOString() }
    expect(scopeSummaryText([one, same])).toBe('2 Reuniões · 21/10')
  })

  it('inclui o ano quando o intervalo cruza anos e trata o vazio', () => {
    const a = { ...meeting('a', 0), createdAt: new Date(2026, 11, 30, 10).toISOString() }
    const b = { ...meeting('b', 0), createdAt: new Date(2027, 0, 3, 10).toISOString() }
    expect(scopeSummaryText([a, b])).toBe('2 Reuniões · 30/12/2026 a 03/01/2027')
    expect(scopeSummaryText([])).toBe('Nenhuma Reunião')
  })
})

describe('assignLabels', () => {
  it('numera da mais antiga para a mais recente e mantém os rótulos já dados', () => {
    const first = assignLabels({}, [
      { id: 'novo', createdAt: '2026-10-20T10:00:00.000Z' },
      { id: 'velho', createdAt: '2026-10-10T10:00:00.000Z' }
    ])
    expect(first.labels).toEqual({ velho: 1, novo: 2 })
    expect(first.added).toBe(true)

    const second = assignLabels(first.labels, [
      { id: 'velho', createdAt: '2026-10-10T10:00:00.000Z' },
      { id: 'entre', createdAt: '2026-10-15T10:00:00.000Z' }
    ])
    expect(second.labels).toEqual({ velho: 1, novo: 2, entre: 3 })
    expect(
      assignLabels(second.labels, [{ id: 'novo', createdAt: '2026-10-20T10:00:00.000Z' }]).added
    ).toBe(false)
  })
})

describe('parseGroupChat', () => {
  const message = {
    id: 'm1',
    role: 'assistant',
    text: 'Decidiram X [R1 05:32].',
    createdAt: '2026-10-21T12:00:00.000Z',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    scope: [
      {
        id: 'a',
        label: 1,
        name: 'Daily',
        createdAt: '2026-10-14T10:00:00.000Z',
        durationMs: 60_000,
        level: 'full'
      }
    ]
  }

  it('lê mensagens com o escopo usado, o escopo escolhido e os rótulos', () => {
    const chat = parseGroupChat({
      schemaVersion: 1,
      scope: { periodDays: 7, maxMeetings: 8, include: ['x'], exclude: [] },
      labels: { a: 1 },
      messages: [message]
    })
    expect(chat?.scope).toEqual({ periodDays: 7, maxMeetings: 8, include: ['x'], exclude: [] })
    expect(chat?.labels).toEqual({ a: 1 })
    expect(chat?.messages[0]?.scope?.[0]).toMatchObject({ label: 1, level: 'full' })
  })

  it('descarta o que está quebrado sem recusar o arquivo', () => {
    const chat = parseGroupChat({
      schemaVersion: 1,
      scope: 'lixo',
      labels: { a: 1, b: 'x', c: -2 },
      messages: [
        message,
        { id: 'sem-texto', role: 'user' },
        { ...message, id: 'm2', scope: [{ id: 'sem-rotulo' }, 7] }
      ]
    })
    expect(chat?.scope).toEqual(DEFAULT_SCOPE)
    expect(chat?.labels).toEqual({ a: 1 })
    expect(chat?.messages.map((item) => item.id)).toEqual(['m1', 'm2'])
    expect(chat?.messages[1]?.scope).toBeUndefined()
  })

  it('recusa só arquivo de outra versão ou que não é objeto', () => {
    expect(parseGroupChat({ schemaVersion: 2 })).toBeNull()
    expect(parseGroupChat([])).toBeNull()
    expect(parseGroupChat(null)).toBeNull()
  })
})
