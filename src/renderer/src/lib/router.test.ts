import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROUTE,
  ROUTES,
  hrefFor,
  meetingHref,
  parseHash,
  parseHashParams,
  groupHref,
  meetingsGroupHref,
  parseGroupId,
  parseMeetingId,
  parseMeetingsGroup,
  parseMeetingsView,
  parseMeetingStart
} from './router'

describe('router', () => {
  it('tem as áreas do app', () => {
    expect([...ROUTES]).toEqual(['record', 'meetings', 'meeting', 'group', 'settings'])
  })

  it('interpreta o hash de cada rota', () => {
    for (const route of ROUTES) expect(parseHash(hrefFor(route))).toBe(route)
  })

  it('aceita variações do hash', () => {
    expect(parseHash('#meetings')).toBe('meetings')
    expect(parseHash('#/meeting/abc?x=1')).toBe('meeting')
  })

  it('cai na rota padrão para hash vazio ou desconhecido', () => {
    expect(parseHash('')).toBe(DEFAULT_ROUTE)
    expect(parseHash('#')).toBe(DEFAULT_ROUTE)
    expect(parseHash('#/nada')).toBe(DEFAULT_ROUTE)
    expect(parseHash('#/constructor')).toBe(DEFAULT_ROUTE)
  })
})

describe('Reunião no hash', () => {
  it('monta e lê o link de uma Reunião (id com símbolos incluso)', () => {
    expect(meetingHref('abc-123')).toBe('#/meeting?id=abc-123')
    for (const id of ['abc-123', 'a b&c=d', '96596920-647a-478a-8e80-4c900b981419']) {
      expect(parseHash(meetingHref(id))).toBe('meeting')
      expect(parseMeetingId(meetingHref(id))).toBe(id)
    }
  })

  it('sem id, ou em outra rota, não há Reunião aberta', () => {
    expect(parseMeetingId('#/meeting')).toBeNull()
    expect(parseMeetingId('#/meeting?id=')).toBeNull()
    expect(parseMeetingId('#/meetings?id=abc')).toBeNull()
    expect(parseMeetingId('')).toBeNull()
  })

  it('lê os parâmetros do hash', () => {
    expect(parseHashParams('#/meeting?id=x&y=1').get('y')).toBe('1')
    expect(parseHashParams('#/meeting').get('id')).toBeNull()
  })
})

describe('Instante inicial no hash', () => {
  it('monta o link com o Instante e o lê de volta', () => {
    expect(meetingHref('abc', 61_500)).toBe('#/meeting?id=abc&t=61500')
    expect(parseMeetingStart(meetingHref('abc', 61_500))).toBe(61_500)
    expect(parseMeetingId(meetingHref('abc', 61_500))).toBe('abc')
    expect(parseMeetingStart(meetingHref('abc', 0))).toBe(0)
  })

  it('arredonda e ignora Instantes inválidos ao montar o link', () => {
    expect(meetingHref('abc', 1500.6)).toBe('#/meeting?id=abc&t=1501')
    for (const invalid of [null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(meetingHref('abc', invalid)).toBe('#/meeting?id=abc')
    }
  })

  it('sem t, com t inválido ou fora da rota da Reunião não há Instante', () => {
    expect(parseMeetingStart('#/meeting?id=abc')).toBeNull()
    expect(parseMeetingStart('#/meeting?id=abc&t=')).toBeNull()
    expect(parseMeetingStart('#/meeting?id=abc&t=-5')).toBeNull()
    expect(parseMeetingStart('#/meeting?id=abc&t=1.5')).toBeNull()
    expect(parseMeetingStart('#/meeting?id=abc&t=abc')).toBeNull()
    expect(parseMeetingStart('#/meetings?id=abc&t=100')).toBeNull()
    expect(parseMeetingStart('')).toBeNull()
  })

  it('o t pode vir antes do id', () => {
    expect(parseMeetingStart('#/meeting?t=9000&id=abc')).toBe(9000)
    expect(parseMeetingId('#/meeting?t=9000&id=abc')).toBe('abc')
  })
})

describe('grupos no hash', () => {
  it('monta e lê o link de um grupo', () => {
    for (const id of ['abc-123', 'a b&c=d']) {
      expect(parseHash(groupHref(id))).toBe('group')
      expect(parseGroupId(groupHref(id))).toBe(id)
    }
    expect(parseGroupId('#/group')).toBeNull()
    expect(parseGroupId('#/meeting?id=x')).toBeNull()
  })

  it('lê a aba e o filtro de grupo da tela Reuniões', () => {
    expect(parseMeetingsView('#/meetings')).toBe('all')
    expect(parseMeetingsView('#/meetings?view=groups')).toBe('groups')
    expect(parseMeetingsView('#/settings?view=groups')).toBe('all')
    expect(parseMeetingsGroup('#/meetings')).toBeNull()
    expect(parseMeetingsGroup(meetingsGroupHref('none'))).toBe('none')
    expect(parseMeetingsGroup(meetingsGroupHref('a&b'))).toBe('a&b')
  })
})
