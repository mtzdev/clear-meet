import { describe, expect, it } from 'vitest'
import type { RawUtterance } from './parse'
import type { ChunkPlan } from './plan'
import {
  finalizeUtterances,
  isGenericSpeaker,
  mergeChunks,
  mergeGhostSpeakers,
  speakersOf,
  textSimilarity,
  toAbsolute,
  voteSpeakers,
  type ChunkResult
} from './reconcile'

const MIN = 60_000
const SEC = 1000
const at = (minutes: number, seconds = 0): number => minutes * MIN + seconds * SEC

/**
 * Dois blocos de uma Reunião de 30 min com 60 s de sobreposição (o tamanho real é só uma constante;
 * aqui o desenho é fixo): [0, 15:00] e [14:00, 30:00]. A emenda fica em 14:30: antes dela vale o
 * bloco 0, depois vale o bloco 1.
 */
const plan0: ChunkPlan = {
  index: 0,
  startMs: 0,
  endMs: at(15),
  ownFromMs: 0,
  ownToMs: at(14, 30)
}
const plan1: ChunkPlan = {
  index: 1,
  startMs: at(14),
  endMs: at(30),
  ownFromMs: at(14, 30),
  ownToMs: Number.POSITIVE_INFINITY
}
// Instantes do bloco 1 são relativos ao início dele (14:00).
const rel = (minutes: number, seconds = 0): number => at(minutes, seconds)

const raw = (speaker: string, startMs: number, text: string): RawUtterance => ({
  speaker,
  startMs,
  text
})

function merge(first: RawUtterance[], second: RawUtterance[]) {
  const results: ChunkResult[] = [
    { plan: plan0, utterances: first },
    { plan: plan1, utterances: second }
  ]
  return mergeChunks(results)
}

describe('toAbsolute', () => {
  it('soma o início do bloco ao Instante de cada Fala', () => {
    expect(toAbsolute(plan1, [raw('Ana', 10 * SEC, 'oi')])).toEqual([
      { speaker: 'Ana', startMs: plan1.startMs + 10 * SEC, text: 'oi' }
    ])
  })
})

describe('textSimilarity', () => {
  it('ignora acentos, maiúsculas e pontuação', () => {
    expect(textSimilarity('Vamos começar, então!', 'vamos comecar entao')).toBe(1)
    expect(textSimilarity('a b c d', 'a b x y')).toBeCloseTo(1 / 3)
    expect(textSimilarity('', 'a')).toBe(0)
  })
})

describe('mergeChunks: Instantes e emenda', () => {
  it('um bloco só: devolve as Falas como vieram', () => {
    const merged = mergeChunks([{ plan: plan0, utterances: [raw('Ana', 5 * SEC, 'oi pessoal')] }])
    expect(merged).toEqual([{ speaker: 'Ana', startMs: 5 * SEC, text: 'oi pessoal' }])
    expect(mergeChunks([])).toEqual([])
  })

  it('ajusta o offset do segundo bloco e fica com cada metade da sobreposição de um lado', () => {
    const merged = merge(
      [
        raw('Ana', at(13, 30), 'vamos revisar o orçamento do trimestre'),
        raw('Bia', at(14, 10), 'concordo com a proposta do cliente')
      ],
      [
        // 14:00 + 00:10 = 14:10: repete a Fala da Bia, que fica com o bloco 0 (antes da emenda).
        raw('Bia', rel(0, 10), 'concordo com a proposta do cliente'),
        raw('Ana', rel(1, 10), 'agora o próximo assunto é a entrega')
      ]
    )
    expect(merged).toEqual([
      { speaker: 'Ana', startMs: at(13, 30), text: 'vamos revisar o orçamento do trimestre' },
      { speaker: 'Bia', startMs: at(14, 10), text: 'concordo com a proposta do cliente' },
      { speaker: 'Ana', startMs: at(15, 10), text: 'agora o próximo assunto é a entrega' }
    ])
  })

  it('descarta a Fala repetida logo depois da emenda (Instantes um pouco diferentes)', () => {
    const merged = merge(
      [raw('Ana', at(14, 29), 'então ficamos combinados para quinta feira')],
      [
        // 14:00 + 00:32 = 14:32, depois da emenda (14:30), mas é a mesma frase do bloco 0.
        raw('Ana', rel(0, 32), 'então ficamos combinados para quinta-feira'),
        raw('Bia', rel(2), 'perfeito, obrigada')
      ]
    )
    expect(merged.map((u) => u.text)).toEqual([
      'então ficamos combinados para quinta feira',
      'perfeito, obrigada'
    ])
  })

  it('Fala do fim do bloco anterior depois da emenda é substituída pela do bloco novo', () => {
    const merged = merge(
      [raw('Ana', at(14, 50), 'texto cortado do final do bloco zero')],
      [raw('Ana', rel(0, 55), 'texto completo e correto vindo do bloco um')]
    )
    expect(merged.map((u) => u.text)).toEqual(['texto completo e correto vindo do bloco um'])
  })
})

describe('mergeChunks: reconciliação de Falantes', () => {
  it('rótulos trocados entre os blocos são corrigidos pela sobreposição', () => {
    const merged = merge(
      [
        raw('Falante 1', at(14, 5), 'o relatório fica pronto na sexta feira'),
        raw('Falante 2', at(14, 20), 'perfeito então fechamos assim')
      ],
      [
        // No bloco novo a IA numerou ao contrário: "Falante 2" é quem era "Falante 1".
        raw('Falante 2', rel(0, 5), 'o relatório fica pronto na sexta feira'),
        raw('Falante 1', rel(0, 20), 'perfeito então fechamos assim'),
        raw('Falante 1', rel(1, 30), 'obrigado a todos pela presença'),
        raw('Falante 2', rel(2), 'até a próxima semana')
      ]
    )
    expect(merged.slice(-2)).toEqual([
      { speaker: 'Falante 2', startMs: at(15, 30), text: 'obrigado a todos pela presença' },
      { speaker: 'Falante 1', startMs: at(16), text: 'até a próxima semana' }
    ])
  })

  it('três vozes continuam três vozes, mesmo com os rótulos embaralhados no bloco novo', () => {
    const merged = merge(
      [
        raw('Falante 1', at(14, 5), 'primeiro vamos falar do orçamento do projeto'),
        raw('Falante 2', at(14, 12), 'sobre os prazos eu tenho uma preocupação grande'),
        raw('Falante 3', at(14, 20), 'o cliente pediu uma reunião extra na semana que vem')
      ],
      [
        raw('Falante 3', rel(0, 5), 'primeiro vamos falar do orçamento do projeto'),
        raw('Falante 1', rel(0, 12), 'sobre os prazos eu tenho uma preocupação grande'),
        raw('Falante 2', rel(0, 20), 'o cliente pediu uma reunião extra na semana que vem'),
        raw('Falante 3', rel(2), 'então fica decidido o orçamento'),
        raw('Falante 1', rel(2, 30), 'e os prazos seguem como estão'),
        raw('Falante 2', rel(3), 'marco a reunião com o cliente')
      ]
    )
    const later = merged.filter((u) => u.startMs >= at(16))
    expect(later.map((u) => u.speaker)).toEqual(['Falante 1', 'Falante 2', 'Falante 3'])
    expect(new Set(merged.map((u) => u.speaker)).size).toBe(3)
  })

  it('o nome dito num bloco posterior passa a valer para o Falante genérico em toda a Transcrição', () => {
    const merged = merge(
      [
        raw('Falante 2', at(2), 'bom dia a todos'),
        raw('Falante 2', at(14, 5), 'vou compartilhar a minha tela agora'),
        raw('Falante 1', at(14, 10), 'pode compartilhar sim')
      ],
      [
        raw('Carlos', rel(0, 5), 'vou compartilhar a minha tela agora'),
        raw('Falante 1', rel(0, 10), 'pode compartilhar sim'),
        raw('Carlos', rel(3), 'esse é o resultado do mês')
      ]
    )
    expect(merged.map((u) => u.speaker)).toEqual(['Carlos', 'Carlos', 'Falante 1', 'Carlos'])
  })

  it('nomes iguais (ignorando acento e caixa) e Falantes realmente novos são mantidos', () => {
    const merged = merge(
      [raw('José', at(1), 'olá, aqui é o José')],
      [
        raw('JOSE', rel(5), 'sigo com a apresentação'),
        raw('Falante 3', rel(6), 'tenho uma dúvida sobre o prazo')
      ]
    )
    expect(merged.map((u) => u.speaker)).toEqual(['José', 'José', 'Falante 3'])
  })

  it('sem sobreposição que case, um rótulo repetido continua sendo o mesmo Falante', () => {
    const merged = merge(
      [raw('Falante 1', at(1), 'bom dia')],
      [raw('Falante 1', rel(5), 'seguimos para o próximo item da pauta')]
    )
    expect(merged.map((u) => u.speaker)).toEqual(['Falante 1', 'Falante 1'])
  })

  it('duas vozes do bloco novo nunca se fundem num único Falante já existente', () => {
    // O bloco 0 juntou duas pessoas sob "Falante 1"; o bloco novo separa corretamente em 1 e 2.
    const merged = merge(
      [
        raw('Falante 1', at(14, 5), 'primeiro item é o orçamento do projeto'),
        raw('Falante 1', at(14, 15), 'segundo item são os prazos de entrega')
      ],
      [
        raw('Falante 1', rel(0, 5), 'primeiro item é o orçamento do projeto'),
        raw('Falante 2', rel(0, 15), 'segundo item são os prazos de entrega'),
        raw('Falante 2', rel(3), 'sigo discordando do prazo')
      ]
    )
    expect(merged.at(-1)?.speaker).toBe('Falante 2')
    expect(new Set(merged.map((u) => u.speaker)).size).toBe(2)
  })

  it('um rótulo sem correspondência que colidiria com um Falante já ocupado vira um Falante novo', () => {
    const merged = merge(
      [
        raw('Falante 1', at(14, 5), 'texto um sobre o planejamento da semana'),
        raw('Falante 2', at(14, 20), 'texto dois sobre a execução das tarefas')
      ],
      [
        // "Falante 1" do bloco novo é, pelo texto, o Falante 2; e o "Falante 2" dele não aparece
        // na sobreposição: não pode herdar o Falante 2 que já tem dono.
        raw('Falante 1', rel(0, 20), 'texto dois sobre a execução das tarefas'),
        raw('Falante 2', rel(3), 'uma terceira pessoa entra na conversa')
      ]
    )
    expect(merged.at(-1)?.speaker).toBe('Falante 3')
  })
})

describe('voteSpeakers', () => {
  const existing = [
    { speaker: 'Ana', startMs: at(14, 40), text: 'vamos ao primeiro assunto da pauta' },
    { speaker: 'Bia', startMs: at(14, 50), text: 'tenho uma atualização sobre o projeto' }
  ]

  it('casa Falas por Instante próximo e texto parecido', () => {
    const mapping = voteSpeakers(existing, [
      { speaker: 'Falante 1', startMs: at(14, 42), text: 'vamos ao primeiro assunto da pauta' },
      { speaker: 'Falante 2', startMs: at(14, 50), text: 'tenho uma atualização sobre o projeto' }
    ])
    expect(mapping.get('Falante 1')).toBe('Ana')
    expect(mapping.get('Falante 2')).toBe('Bia')
  })

  it('não casa Falas distantes no tempo nem textos diferentes', () => {
    const mapping = voteSpeakers(existing, [
      { speaker: 'X', startMs: at(10), text: 'vamos ao primeiro assunto da pauta' },
      { speaker: 'Y', startMs: at(14, 40), text: 'completamente outra coisa aqui hoje' }
    ])
    expect(mapping.size).toBe(0)
  })

  it('exige peso mínimo: um "sim" solto não decide', () => {
    const mapping = voteSpeakers(
      [{ speaker: 'Ana', startMs: at(14, 40), text: 'sim' }],
      [{ speaker: 'X', startMs: at(14, 40), text: 'sim' }]
    )
    expect(mapping.size).toBe(0)
  })

  it('dois rótulos para o mesmo Falante: só o de maior peso fica', () => {
    const mapping = voteSpeakers(
      [
        {
          speaker: 'Ana',
          startMs: at(14, 10),
          text: 'uma frase bem longa com várias palavras aqui'
        },
        { speaker: 'Ana', startMs: at(14, 30), text: 'outra frase curta demais' }
      ],
      [
        { speaker: 'X', startMs: at(14, 10), text: 'uma frase bem longa com várias palavras aqui' },
        { speaker: 'Y', startMs: at(14, 30), text: 'outra frase curta demais' }
      ]
    )
    expect([...mapping.entries()]).toEqual([['X', 'Ana']])
  })
})

describe('finalizeUtterances e speakersOf', () => {
  it('ordena, numera as Falas e dá um id a cada Falante, na ordem de aparição', () => {
    const { speakers, utterances } = finalizeUtterances([
      { speaker: 'Falante 2', startMs: 5000, text: 'segunda' },
      { speaker: 'Ana', startMs: 1000, text: 'primeira' }
    ])
    // O "Falante 2" é renumerado para "Falante 1" (id s1); o nome próprio pega o próximo número livre.
    expect(speakers).toEqual([
      { id: 's2', name: 'Ana' },
      { id: 's1', name: null }
    ])
    expect(utterances).toEqual([
      { id: 'u1', speakerId: 's2', startMs: 1000, text: 'primeira' },
      { id: 'u2', speakerId: 's1', startMs: 5000, text: 'segunda' }
    ])
  })

  it('remove repetição colada do mesmo Falante com o mesmo texto', () => {
    const { utterances } = finalizeUtterances([
      { speaker: 'Ana', startMs: 1000, text: 'oi' },
      { speaker: 'Ana', startMs: 1500, text: 'oi' },
      { speaker: 'Bia', startMs: 2000, text: 'oi' }
    ])
    expect(utterances.map((u) => u.speakerId)).toEqual(['s1', 's2'])
  })

  it('speakersOf junta os nomes de vários blocos sem repetir', () => {
    expect(
      speakersOf([
        { plan: plan0, utterances: [raw('Ana', 0, 'a'), raw('Falante 2', 1, 'b')] },
        { plan: plan1, utterances: [raw('Ana', 0, 'c'), raw('Bia', 1, 'd')] }
      ])
    ).toEqual(['Ana', 'Falante 2', 'Bia'])
  })

  it('isGenericSpeaker reconhece só "Falante N"', () => {
    expect(isGenericSpeaker('Falante 12')).toBe(true)
    expect(isGenericSpeaker('Falante')).toBe(false)
    expect(isGenericSpeaker('Ana')).toBe(false)
  })
})

describe('Falantes fantasmas', () => {
  /** 100 Falas de Ana e Bia, alternadas, a cada 10 s. */
  const dialogue = Array.from({ length: 100 }, (_, i) => ({
    speaker: i % 2 === 0 ? 'Ana' : 'Bia',
    startMs: i * 10_000,
    text: `fala ${i}`
  }))

  it('funde no Falante da Fala anterior quem tem até 2 Falas e menos de 1% do tempo', () => {
    const noisy = [
      ...dialogue,
      { speaker: 'Falante 5', startMs: 55_000, text: 'ruído um' },
      { speaker: 'Falante 6', startMs: 405_000, text: 'ruído dois' }
    ].sort((a, b) => a.startMs - b.startMs)
    const merged = mergeGhostSpeakers(noisy)
    expect(merged.find((u) => u.text === 'ruído um')?.speaker).toBe('Bia')
    expect(merged.find((u) => u.text === 'ruído dois')?.speaker).toBe('Ana')
    expect(new Set(merged.map((u) => u.speaker))).toEqual(new Set(['Ana', 'Bia']))
  })

  it('se for a primeira Fala, vai para o Falante da seguinte', () => {
    const merged = mergeGhostSpeakers([
      { speaker: 'Falante 4', startMs: 0, text: 'ruído' },
      ...dialogue.map((u) => ({ ...u, startMs: u.startMs + 5000 }))
    ])
    expect(merged[0]?.speaker).toBe('Ana')
  })

  it('não funde quem tem nome, nem quem tem mais de 2 Falas, nem quem fala bastante', () => {
    const named = [...dialogue, { speaker: 'Carlos', startMs: 55_000, text: 'oi' }]
    expect(new Set(mergeGhostSpeakers(named).map((u) => u.speaker)).has('Carlos')).toBe(true)

    const three = [
      ...dialogue,
      ...[1, 2, 3].map((n) => ({ speaker: 'Falante 5', startMs: 55_000 + n, text: `r${n}` }))
    ].sort((a, b) => a.startMs - b.startMs)
    expect(new Set(mergeGhostSpeakers(three).map((u) => u.speaker)).has('Falante 5')).toBe(true)

    // Duas Falas curtas, mas em meia hora de gravação de só três pessoas: 2 Falas de 30 s = 5%.
    const sparse = [
      { speaker: 'Ana', startMs: 0, text: 'a' },
      { speaker: 'Falante 2', startMs: 60_000, text: 'b' },
      { speaker: 'Ana', startMs: 120_000, text: 'c' }
    ]
    expect(new Set(mergeGhostSpeakers(sparse).map((u) => u.speaker)).has('Falante 2')).toBe(true)
  })

  it('com menos de 20 Falas não julga nada', () => {
    const few = [
      { speaker: 'Ana', startMs: 0, text: 'a' },
      { speaker: 'Falante 2', startMs: 1000, text: 'b' }
    ]
    expect(mergeGhostSpeakers(few)).toEqual(few)
  })

  it('sem nenhum Falante de verdade, deixa tudo como está', () => {
    const only = [{ speaker: 'Falante 3', startMs: 0, text: 'só eu' }]
    expect(mergeGhostSpeakers(only)).toEqual(only)
  })

  it('finalizeUtterances renumera os "Falante N" em sequência por ordem de aparição', () => {
    const { speakers, utterances } = finalizeUtterances([
      ...dialogue.map((u) => ({ ...u, speaker: u.speaker === 'Ana' ? 'Falante 7' : 'Falante 2' })),
      { speaker: 'Falante 9', startMs: 55_000, text: 'ruído' }
    ])
    // "Falante 7" apareceu primeiro, então vira 1; "Falante 2" vira 2; o ruído sumiu.
    expect(speakers).toEqual([
      { id: 's1', name: null },
      { id: 's2', name: null }
    ])
    expect(utterances[0]?.speakerId).toBe('s1')
    expect(utterances[1]?.speakerId).toBe('s2')
    expect(utterances).toHaveLength(101)
    expect(utterances.every((u) => ['s1', 's2'].includes(u.speakerId))).toBe(true)
  })

  it('o log avisa quando um Falante novo aparece e só um Falante do bloco anterior sumiu', () => {
    const messages: string[] = []
    mergeChunks(
      [
        {
          plan: plan0,
          utterances: [
            raw('Falante 1', at(14, 5), 'primeiro item é o orçamento do projeto'),
            raw('Falante 2', at(14, 40), 'e eu cuido dos prazos de entrega')
          ]
        },
        {
          plan: plan1,
          utterances: [
            raw('Falante 1', rel(0, 5), 'primeiro item é o orçamento do projeto'),
            raw('Falante 3', rel(5), 'uma voz que parece nova nesta parte')
          ]
        }
      ],
      (message) => messages.push(message)
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('Falante 3')
    expect(messages[0]).toContain('Falante 2')
    expect(messages[0]).toContain('não fundido')
  })
})
