import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROUTE,
  ROUTES,
  hrefFor,
  meetingHref,
  parseHash,
  parseHashParams,
  parseMeetingId
} from './router'

describe('router', () => {
  it('tem as 4 áreas do app', () => {
    expect([...ROUTES]).toEqual(['record', 'meetings', 'meeting', 'settings'])
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
