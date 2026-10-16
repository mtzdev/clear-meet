import { describe, expect, it } from 'vitest'
import type { TranscribedWord } from '../gemini'
import { groupWords } from './words'

const word = (
  text: string,
  speaker: string,
  startSec: number,
  endSec?: number
): TranscribedWord => ({
  text,
  speaker,
  startMs: Math.round(startSec * 1000),
  endMs: Math.round((endSec ?? startSec + 0.3) * 1000)
})

const CHUNK = 10 * 60_000

describe('groupWords', () => {
  it('uma Fala por Falante: troca de voz quebra, e o Instante é o da primeira palavra', () => {
    const result = groupWords(
      [
        word('Bom', 'spk_1', 1),
        word('dia', 'spk_1', 1.4),
        word('Bom', 'spk_2', 2),
        word('dia', 'spk_2', 2.4),
        word('Vamos', 'spk_1', 3)
      ],
      { chunkDurationMs: CHUNK }
    )
    expect(result).toEqual([
      { speaker: 'Falante 1', startMs: 1000, text: 'Bom dia' },
      { speaker: 'Falante 2', startMs: 2000, text: 'Bom dia' },
      { speaker: 'Falante 1', startMs: 3000, text: 'Vamos' }
    ])
  })

  it('pausa acima de 1,5 s separa Falas do mesmo Falante; abaixo disso, não', () => {
    const result = groupWords(
      [word('um', 'spk_1', 1, 1.3), word('dois', 'spk_1', 2.5, 2.8), word('três', 'spk_1', 5, 5.3)],
      { chunkDurationMs: CHUNK }
    )
    expect(result.map((u) => [u.startMs, u.text])).toEqual([
      [1000, 'um dois'],
      [5000, 'três']
    ])
  })

  it('Fala maior que 60 s quebra na primeira pausa curta', () => {
    const run: TranscribedWord[] = []
    for (let i = 0; i < 160; i++) {
      // Palavras a cada 0,5 s; uma pausa de 0,5 s aos 62 s.
      const start = i * 0.5 + (i * 0.5 >= 62 ? 0.5 : 0)
      run.push(word(`p${i}`, 'spk_1', start, start + 0.45))
    }
    const result = groupWords(run, { chunkDurationMs: CHUNK })
    expect(result).toHaveLength(2)
    expect(result[1]?.startMs).toBe(62_500)
  })

  it('rótulos seguem a ordem de aparição e somam a base do bloco', () => {
    const words = [word('a', 'spk_2', 1), word('b', 'spk_1', 5), word('c', 'spk_2', 9)]
    expect(groupWords(words, { chunkDurationMs: CHUNK }).map((u) => u.speaker)).toEqual([
      'Falante 1',
      'Falante 2',
      'Falante 1'
    ])
    expect(
      groupWords(words, { chunkDurationMs: CHUNK, speakerBase: 100 }).map((u) => u.speaker)
    ).toEqual(['Falante 101', 'Falante 102', 'Falante 101'])
  })

  it('pontuação solta cola na palavra anterior', () => {
    const result = groupWords(
      [
        word('Olá', 'spk_1', 1),
        word(',', 'spk_1', 1.3),
        word('tudo', 'spk_1', 1.5),
        word('?', 'spk_1', 1.8)
      ],
      { chunkDurationMs: CHUNK }
    )
    expect(result[0]?.text).toBe('Olá, tudo?')
  })

  it('palavra sem Falante continua com o anterior; além do fim do bloco é descartada', () => {
    const result = groupWords(
      [
        word('a', 'spk_1', 1),
        { ...word('b', 'spk_1', 1.4), speaker: null },
        word('fim', 'spk_1', 700)
      ],
      { chunkDurationMs: CHUNK }
    )
    expect(result).toEqual([{ speaker: 'Falante 1', startMs: 1000, text: 'a b' }])
  })

  it('sem palavras, sem Falas', () => {
    expect(groupWords([], { chunkDurationMs: CHUNK })).toEqual([])
  })
})
