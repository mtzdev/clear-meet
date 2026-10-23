import { describe, expect, it } from 'vitest'
import { citedMeetings, tokenizeGroupInline, type CitedMeeting } from './group-citations'

const meetings = new Map<number, CitedMeeting>([
  [1, { id: 'daily', name: 'Daily 14/10', durationMs: 4_000_000 }],
  [2, { id: 'weekly', name: 'Weekly', durationMs: 600_000 }]
])

describe('tokenizeGroupInline', () => {
  it('transforma [R2 05:32] em citação da Reunião com o Instante', () => {
    expect(tokenizeGroupInline('Adiaram [R2 05:32].', meetings)).toEqual([
      { type: 'text', text: 'Adiaram ' },
      { type: 'cite', meetingId: 'weekly', name: 'Weekly', ms: 332_000, instant: '05:32' },
      { type: 'text', text: '.' }
    ])
  })

  it('aceita h:mm:ss, minúscula e separadores comuns entre rótulo e Instante', () => {
    const tokens = tokenizeGroupInline('[R1 1:02:03] [r1 · 00:10] [R1, 00:20]', meetings)
    const cites = tokens.filter((token) => token.type === 'cite')
    expect(cites.map((token) => token.type === 'cite' && token.ms)).toEqual([
      3_723_000, 10_000, 20_000
    ])
  })

  it('várias citações no mesmo colchete; sem rótulo herda o anterior', () => {
    const tokens = tokenizeGroupInline('[R1 05:32, R2 01:10, 02:00]', meetings)
    const cites = tokens.filter((token) => token.type === 'cite')
    expect(cites.map((token) => token.type === 'cite' && [token.meetingId, token.ms])).toEqual([
      ['daily', 332_000],
      ['weekly', 70_000],
      ['weekly', 120_000]
    ])
  })

  it('rótulo desconhecido vira texto', () => {
    expect(tokenizeGroupInline('veja [R9 05:32]', meetings)).toEqual([
      { type: 'text', text: 'veja [R9 05:32]' }
    ])
  })

  it('Instante além da duração da Reunião vira texto (com folga de 5 s)', () => {
    expect(tokenizeGroupInline('[R2 10:04]', meetings)[0]?.type).toBe('cite')
    expect(tokenizeGroupInline('[R2 20:00]', meetings)).toEqual([
      { type: 'text', text: '[R2 20:00]' }
    ])
  })

  it('parte válida e parte inválida no mesmo colchete: a válida continua link', () => {
    const tokens = tokenizeGroupInline('[R2 05:32, R7 01:00]', meetings)
    expect(tokens.map((token) => token.type)).toEqual(['cite', 'text'])
    expect(tokens[1]).toEqual({ type: 'text', text: ' [R7 01:00]' })
  })

  it('Instante sem rótulo ([05:32]) não é citação do grupo', () => {
    expect(tokenizeGroupInline('em [05:32]', meetings)).toEqual([
      { type: 'text', text: 'em [05:32]' }
    ])
  })

  it('mantém negrito e código, e a Reunião sem duração aceita qualquer Instante', () => {
    const open = new Map<number, CitedMeeting>([[1, { id: 'x', name: 'X', durationMs: null }]])
    const tokens = tokenizeGroupInline('**Decisão** `código` [R1 99:00]', open)
    expect(tokens.map((token) => token.type)).toEqual(['bold', 'text', 'code', 'text', 'cite'])
  })
})

describe('citedMeetings', () => {
  it('indexa a lista de Reuniões da resposta pelo rótulo', () => {
    const map = citedMeetings([
      {
        id: 'a',
        label: 3,
        name: 'Daily',
        createdAt: '2026-10-14T10:00:00.000Z',
        durationMs: 1000,
        level: 'summary'
      }
    ])
    expect(map.get(3)).toEqual({ id: 'a', name: 'Daily', durationMs: 1000 })
    expect(citedMeetings(undefined).size).toBe(0)
  })
})
