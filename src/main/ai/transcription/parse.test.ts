import { describe, expect, it } from 'vitest'
import { ChunkParseError, parseChunkResponse, parseTimestamp, sanitizeSpeakerName } from './parse'

const DURATION = 20 * 60_000

const reply = (speakers: { id: string; name: string | null }[], utterances: unknown[]): string =>
  JSON.stringify({ speakers, utterances })

describe('parseTimestamp', () => {
  it('lê MM:SS, H:MM:SS, décimos e vírgula', () => {
    expect(parseTimestamp('00:05')).toBe(5000)
    expect(parseTimestamp('01:05')).toBe(65_000)
    expect(parseTimestamp('1:02:03')).toBe(3_723_000)
    expect(parseTimestamp('01:05.5')).toBe(65_500)
    expect(parseTimestamp('01:05,5')).toBe(65_500)
    expect(parseTimestamp(' 75:00 ')).toBe(4_500_000)
  })

  it('número solto vale segundos; o resto é ilegível', () => {
    expect(parseTimestamp(12.5)).toBe(12_500)
    expect(parseTimestamp(-1)).toBeNull()
    expect(parseTimestamp('abc')).toBeNull()
    expect(parseTimestamp('1:2:3:4')).toBeNull()
    expect(parseTimestamp('12')).toBeNull()
    expect(parseTimestamp(null)).toBeNull()
  })
})

describe('sanitizeSpeakerName', () => {
  it('aceita nomes de pessoas', () => {
    expect(sanitizeSpeakerName('Ana')).toBe('Ana')
    expect(sanitizeSpeakerName('  José   Carlos ')).toBe('José Carlos')
    expect(sanitizeSpeakerName('Dr. Silva')).toBe('Dr. Silva')
    expect(sanitizeSpeakerName("D'Ávila")).toBe("D'Ávila")
  })

  it('recusa horário, número, frase, descrição e rótulo genérico', () => {
    for (const bad of [
      '11:20',
      '00:05',
      '42',
      '---',
      'A',
      '',
      '   ',
      'Falante 2',
      'speaker 1',
      'Desconhecido',
      'unknown',
      'null',
      'Homem de camisa azul falando sobre o orçamento',
      'a'.repeat(50),
      'Ana (gerente)',
      'Sala 3',
      null,
      undefined,
      7
    ]) {
      expect(sanitizeSpeakerName(bad), String(bad)).toBeNull()
    }
  })
})

describe('parseChunkResponse', () => {
  const people = [
    { id: 's1', name: 'Ana' },
    { id: 's2', name: null }
  ]

  it('resolve cada Fala pelo speakerId: nome quando há, senão "Falante N" pelo número do id', () => {
    const { utterances, salvaged } = parseChunkResponse(
      reply(people, [
        { speakerId: 's2', start: '00:10', text: ' Segunda  fala ' },
        { speakerId: 's1', start: '00:03', text: 'Primeira' }
      ]),
      DURATION
    )
    expect(salvaged).toBe(false)
    expect(utterances).toEqual([
      { speaker: 'Ana', startMs: 3000, text: 'Primeira' },
      { speaker: 'Falante 2', startMs: 10_000, text: 'Segunda fala' }
    ])
  })

  it('um horário no campo de nome não vira Falante: o rótulo é "Falante N"', () => {
    const { utterances } = parseChunkResponse(
      reply(
        [
          { id: 's1', name: '11:20' },
          { id: 's3', name: 'Falante 9' }
        ],
        [
          { speakerId: 's1', start: '00:01', text: 'um' },
          { speakerId: 's3', start: '00:02', text: 'três' }
        ]
      ),
      DURATION
    )
    expect(utterances.map((u) => u.speaker)).toEqual(['Falante 1', 'Falante 3'])
  })

  it('id sem número usa a posição na lista; id não declarado usa o número que tiver', () => {
    const { utterances } = parseChunkResponse(
      reply(
        [
          { id: 'ana', name: null },
          { id: 'bia', name: null }
        ],
        [
          { speakerId: 'bia', start: '00:01', text: 'b' },
          { speakerId: 's7', start: '00:02', text: 'sete' },
          { speakerId: 'zzz', start: '00:03', text: 'sem número' }
        ]
      ),
      DURATION
    )
    expect(utterances.map((u) => u.speaker)).toEqual(['Falante 2', 'Falante 7', 'Falante 1'])
  })

  it('um id reaproveitado dos blocos anteriores mantém o nome que já tinha', () => {
    const known = [{ id: 's3', name: 'Carlos' }]
    const { utterances } = parseChunkResponse(
      reply([{ id: 's3', name: null }], [{ speakerId: 's3', start: '00:01', text: 'oi de novo' }]),
      DURATION,
      known
    )
    expect(utterances[0]?.speaker).toBe('Carlos')
  })

  it('formato antigo (rótulo em cada Fala): aproveita nomes e "Falante N", o resto vira Falante 1', () => {
    const { utterances } = parseChunkResponse(
      JSON.stringify({
        utterances: [
          { speaker: 'Ana', start: '00:01', text: 'a' },
          { speaker: 'Speaker 2', start: '00:02', text: 'b' },
          { speaker: '11:20', start: '00:03', text: 'c' }
        ]
      }),
      DURATION
    )
    expect(utterances.map((u) => u.speaker)).toEqual(['Ana', 'Falante 2', 'Falante 1'])
  })

  it('descarta texto vazio, Instante ilegível e Instante além do fim do bloco', () => {
    const { utterances } = parseChunkResponse(
      reply(people, [
        { speakerId: 's1', start: '00:01', text: '   ' },
        { speakerId: 's1', start: 'quando', text: 'sem tempo' },
        { speakerId: 's1', start: '30:00', text: 'inventada' },
        { speakerId: 's1', start: '00:02', text: 'boa' },
        'lixo',
        null
      ]),
      DURATION
    )
    expect(utterances.map((u) => u.text)).toEqual(['boa'])
  })

  it('um pouco além do fim vira o fim do bloco; aceita startMs numérico', () => {
    const { utterances } = parseChunkResponse(
      JSON.stringify({
        speakers: [{ id: 's1', name: 'Ana' }],
        utterances: [
          { speakerId: 's1', start: '20:02', text: 'no limite' },
          { speakerId: 's1', startMs: 1500, text: 'em ms' }
        ]
      }),
      DURATION
    )
    expect(utterances).toEqual([
      { speaker: 'Ana', startMs: 1500, text: 'em ms' },
      { speaker: 'Ana', startMs: DURATION, text: 'no limite' }
    ])
  })

  it('aceita cercas de código e lista solta', () => {
    const fenced =
      '```json\n' + reply(people, [{ speakerId: 's1', start: '00:01', text: 'oi' }]) + '\n```'
    expect(parseChunkResponse(fenced, DURATION).utterances).toHaveLength(1)
    const bare = JSON.stringify([{ speakerId: 's1', start: '00:01', text: 'oi' }])
    expect(parseChunkResponse(bare, DURATION).utterances).toHaveLength(1)
  })

  it('lista vazia é válida (áudio sem fala)', () => {
    expect(parseChunkResponse(reply([], []), DURATION).utterances).toEqual([])
  })

  it('resposta cortada no meio aproveita as Falas completas', () => {
    const full = reply(people, [
      { speakerId: 's1', start: '00:01', text: 'primeira' },
      { speakerId: 's2', start: '00:05', text: 'segunda' }
    ])
    const cut = full.slice(0, full.indexOf('segunda') + 3)
    const { utterances, salvaged } = parseChunkResponse(cut, DURATION)
    expect(salvaged).toBe(true)
    expect(utterances.map((u) => u.text)).toEqual(['primeira'])
  })

  it('resposta malformada lança ChunkParseError', () => {
    for (const bad of ['', 'não é json', '{"outra": 1}', '{"utterances": "x"}', '42', '{"utt']) {
      expect(() => parseChunkResponse(bad, DURATION), bad).toThrow(ChunkParseError)
    }
  })
})
