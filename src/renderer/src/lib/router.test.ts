import { describe, expect, it } from 'vitest'
import { DEFAULT_ROUTE, ROUTES, hrefFor, parseHash } from './router'

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
