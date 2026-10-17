import { describe, expect, it } from 'vitest'
import { buildFtsQuery, makeSnippet, matchRanges, searchTokens } from './search'

describe('searchTokens', () => {
  it('normaliza acentos e maiúsculas e ignora pontuação', () => {
    expect(searchTokens('  Reunião, de PLANEJAMENTO! ')).toEqual(['reuniao', 'de', 'planejamento'])
  })

  it('não repete palavras e limita a quantidade', () => {
    expect(searchTokens('a a b')).toEqual(['a', 'b'])
    expect(searchTokens('1 2 3 4 5 6 7 8 9 10')).toHaveLength(8)
  })

  it('texto sem letras nem números não vira palavra', () => {
    expect(searchTokens('"*- ()')).toEqual([])
  })
})

describe('buildFtsQuery', () => {
  it('cada palavra vira um termo entre aspas com prefixo', () => {
    expect(buildFtsQuery('orçamento Q3')).toBe('"orcamento"* "q3"*')
  })

  it('operadores digitados viram palavras comuns', () => {
    expect(buildFtsQuery('foo OR bar NEAR baz')).toBe('"foo"* "or"* "bar"* "near"* "baz"*')
  })

  it('busca vazia não gera consulta', () => {
    expect(buildFtsQuery('   ')).toBeNull()
    expect(buildFtsQuery('***')).toBeNull()
  })
})

describe('matchRanges', () => {
  it('acha o início de palavras ignorando acentos', () => {
    expect(matchRanges('A Reunião começou', ['reuniao'])).toEqual([[2, 9]])
  })

  it('casa por prefixo, não no meio da palavra', () => {
    expect(matchRanges('preorçamento orçamento', ['orcamento'])).toEqual([[13, 22]])
    expect(matchRanges('orçamentos', ['orcamento'])).toEqual([[0, 9]])
  })

  it('une trechos que se tocam', () => {
    expect(matchRanges('plano plano', ['plano', 'plan'])).toEqual([
      [0, 5],
      [6, 11]
    ])
  })
})

describe('makeSnippet', () => {
  it('marca o termo no texto curto', () => {
    expect(makeSnippet('Vamos fechar o orçamento hoje', ['orcamento'])).toEqual([
      { text: 'Vamos fechar o ', match: false },
      { text: 'orçamento', match: true },
      { text: ' hoje', match: false }
    ])
  })

  it('centra o trecho no termo e usa reticências', () => {
    const text = `${'palavra '.repeat(40)}orçamento ${'depois '.repeat(40)}`
    const parts = makeSnippet(text, ['orcamento'], 100)
    expect(parts[0]).toEqual({ text: '…', match: false })
    expect(parts.at(-1)).toEqual({ text: '…', match: false })
    expect(parts.find((part) => part.match)?.text).toBe('orçamento')
    const joined = parts.map((part) => part.text).join('')
    expect(joined.length).toBeLessThanOrEqual(102)
  })

  it('sem ocorrência mostra o começo do texto', () => {
    expect(makeSnippet('Só o início', ['xyz'])).toEqual([{ text: 'Só o início', match: false }])
  })
})
