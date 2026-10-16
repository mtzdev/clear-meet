import { describe, expect, it } from 'vitest'
import {
  extractInstants,
  isWithinDuration,
  normalizeCitations,
  parseInstantText,
  tokenizeInline
} from './instants'

describe('parseInstantText', () => {
  it('lê mm:ss e h:mm:ss, com ou sem colchetes', () => {
    expect(parseInstantText('12:34')).toBe(754_000)
    expect(parseInstantText('[00:05]')).toBe(5000)
    expect(parseInstantText('1:02:03')).toBe(3_723_000)
    expect(parseInstantText(' 75:10 ')).toBe(4_510_000)
  })

  it('recusa o que não é Instante', () => {
    for (const bad of [
      '',
      '12',
      '12:3',
      '12:60',
      '1:60:00',
      '1:00:60',
      'a:bc',
      '1:2:3:4',
      '-1:00'
    ]) {
      expect(parseInstantText(bad)).toBeNull()
    }
  })
})

describe('normalizeCitations', () => {
  it('converte, ordena, tira repetidos e descarta inválidos e fora da duração', () => {
    const raw = ['05:00', '[01:00]', '05:00', 'lixo', 42, '99:00', null]
    expect(normalizeCitations(raw, 600_000)).toEqual([60_000, 300_000])
  })

  it('tolera alguns segundos além do fim, mas não mais que isso', () => {
    expect(normalizeCitations(['10:03'], 600_000)).toEqual([603_000])
    expect(normalizeCitations(['10:06'], 600_000)).toEqual([])
  })

  it('sem duração conhecida aceita qualquer Instante; entrada que não é lista vira vazio', () => {
    expect(normalizeCitations(['99:00'], null)).toEqual([5_940_000])
    expect(normalizeCitations(['99:00'], 0)).toEqual([5_940_000])
    expect(normalizeCitations('05:00', 600_000)).toEqual([])
    expect(isWithinDuration(1, null)).toBe(true)
  })
})

describe('tokenizeInline', () => {
  it('separa texto, Instantes citados, negrito e código', () => {
    expect(tokenizeInline('Foi **aprovado** [12:34] e depois `ok` [1:02:03].', 4_000_000)).toEqual([
      { type: 'text', text: 'Foi ' },
      { type: 'bold', text: 'aprovado' },
      { type: 'text', text: ' ' },
      { type: 'instant', ms: 754_000, label: '12:34' },
      { type: 'text', text: ' e depois ' },
      { type: 'code', text: 'ok' },
      { type: 'text', text: ' ' },
      { type: 'instant', ms: 3_723_000, label: '1:02:03' },
      { type: 'text', text: '.' }
    ])
  })

  it('vários Instantes no mesmo colchete viram um link cada', () => {
    const tokens = tokenizeInline('Veja [01:00, 02:00] e [03:00-04:00].', 600_000)
    expect(
      tokens.filter((t) => t.type === 'instant').map((t) => t.type === 'instant' && t.ms)
    ).toEqual([60_000, 120_000, 180_000, 240_000])
  })

  it('Instante além da duração da Reunião fica como texto', () => {
    expect(tokenizeInline('Citação [50:00] inventada', 600_000)).toEqual([
      { type: 'text', text: 'Citação [50:00] inventada' }
    ])
  })

  it('colchetes que não são Instantes ficam como estão', () => {
    expect(tokenizeInline('veja [1] e [abc] e [12:7]', null)).toEqual([
      { type: 'text', text: 'veja [1] e [abc] e [12:7]' }
    ])
  })

  it('Instante inválido junto de um válido: só o válido vira link', () => {
    const tokens = tokenizeInline('[01:00, 99:99]', 600_000)
    expect(tokens).toEqual([
      { type: 'instant', ms: 60_000, label: '01:00' },
      { type: 'text', text: ' [99:99]' }
    ])
  })
})

describe('extractInstants', () => {
  it('lista os Instantes citados numa resposta, sem repetir e na ordem em que aparecem', () => {
    const answer =
      'Decidiram adiar [14:20]. O prazo foi revisto [03:05] e confirmado depois [14:20] [01:02:03].'
    expect(extractInstants(answer, 4_000_000)).toEqual([860_000, 185_000, 3_723_000])
  })

  it('ignora Instantes fora da Reunião e respostas sem citação', () => {
    expect(extractInstants('Sem citações.', 600_000)).toEqual([])
    expect(extractInstants('Longe demais [59:00].', 600_000)).toEqual([])
  })
})
