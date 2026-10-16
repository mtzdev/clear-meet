import { describe, expect, it } from 'vitest'
import { parseSummaryResponse, SummaryParseError } from './parse'

const DURATION = 600_000

const valid = {
  overview: '  Equipe alinhou o lançamento. ',
  keyPoints: [
    { text: 'Lançamento em novembro', citations: ['01:00', '[02:30]'] },
    { text: 'Orçamento aprovado', citations: [] }
  ],
  decisions: [{ text: 'Adiar o evento', citations: ['05:00'] }],
  actions: [
    { owner: 'Ana', task: 'Enviar o contrato', due: 'sexta', citations: ['04:10'] },
    { owner: '', task: 'Revisar o texto', due: '', citations: ['09:00'] }
  ]
}

describe('parseSummaryResponse', () => {
  it('converte a resposta em Resumo, com Instantes em ms e campos vazios virando null', () => {
    const content = parseSummaryResponse(JSON.stringify(valid), DURATION)
    expect(content).toEqual({
      overview: 'Equipe alinhou o lançamento.',
      keyPoints: [
        { text: 'Lançamento em novembro', at: [60_000, 150_000] },
        { text: 'Orçamento aprovado', at: [] }
      ],
      decisions: [{ text: 'Adiar o evento', at: [300_000] }],
      actions: [
        { owner: 'Ana', task: 'Enviar o contrato', due: 'sexta', at: [250_000] },
        { owner: null, task: 'Revisar o texto', due: null, at: [540_000] }
      ]
    })
  })

  it('descarta Instantes fora da duração da Reunião e os mal escritos, mantendo o texto', () => {
    const content = parseSummaryResponse(
      JSON.stringify({
        ...valid,
        keyPoints: [{ text: 'Ponto', citations: ['99:00', 'sexta', '01:00', '12:99'] }]
      }),
      DURATION
    )
    expect(content.keyPoints).toEqual([{ text: 'Ponto', at: [60_000] }])
  })

  it('aceita a resposta dentro de uma cerca de código', () => {
    const content = parseSummaryResponse('```json\n' + JSON.stringify(valid) + '\n```', DURATION)
    expect(content.keyPoints).toHaveLength(2)
  })

  it('JSON malformado ou cortado lança SummaryParseError', () => {
    expect(() => parseSummaryResponse('{"overview": "cortado', DURATION)).toThrow(SummaryParseError)
    expect(() => parseSummaryResponse('não é json', DURATION)).toThrow(SummaryParseError)
    expect(() => parseSummaryResponse('[1,2]', DURATION)).toThrow(SummaryParseError)
    expect(() => parseSummaryResponse('', DURATION)).toThrow(SummaryParseError)
  })

  it('resposta sem nenhum conteúdo lança SummaryParseError', () => {
    expect(() =>
      parseSummaryResponse(
        JSON.stringify({ overview: '  ', keyPoints: [], decisions: [], actions: [] }),
        DURATION
      )
    ).toThrow(SummaryParseError)
  })

  it('listas ausentes ou com itens inválidos são toleradas', () => {
    const content = parseSummaryResponse(
      JSON.stringify({
        overview: 'Resumo',
        keyPoints: ['Ponto solto', { text: '' }, 7, { citations: ['01:00'] }],
        decisions: 'nenhuma',
        actions: [{ owner: 'Ana' }, 'x', { task: 'Fazer', owner: 3 }]
      }),
      DURATION
    )
    expect(content.keyPoints).toEqual([{ text: 'Ponto solto', at: [] }])
    expect(content.decisions).toEqual([])
    expect(content.actions).toEqual([{ owner: null, task: 'Fazer', due: null, at: [] }])
  })
})
