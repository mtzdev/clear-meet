import { describe, expect, it } from 'vitest'
import {
  chunkDurationMs,
  matchesPlan,
  OVERLAP_MS,
  planChunks,
  SINGLE_CHUNK_MAX_MS,
  TARGET_CHUNK_MS
} from './plan'

const MIN = 60_000

describe('planChunks', () => {
  it('duração inválida ou zero não gera blocos', () => {
    expect(planChunks(0)).toEqual([])
    expect(planChunks(-5)).toEqual([])
    expect(planChunks(Number.NaN)).toEqual([])
  })

  it('Reunião curta é um bloco só, sem sobreposição', () => {
    const [only, ...rest] = planChunks(10 * MIN)
    expect(rest).toEqual([])
    expect(only).toEqual({
      index: 0,
      startMs: 0,
      endMs: 10 * MIN,
      ownFromMs: 0,
      ownToMs: Number.POSITIVE_INFINITY
    })
    expect(planChunks(SINGLE_CHUNK_MAX_MS)).toHaveLength(1)
  })

  it('passou do limite: divide em blocos iguais, nenhum maior que o alvo', () => {
    const plans = planChunks(SINGLE_CHUNK_MAX_MS + 1000)
    expect(plans).toHaveLength(2)
    for (const plan of plans) {
      expect(chunkDurationMs(plan) - (plan.index === 0 ? 0 : OVERLAP_MS)).toBeLessThanOrEqual(
        TARGET_CHUNK_MS
      )
    }
  })

  it('1 hora vira 3 blocos de 20 min; do segundo em diante repetem 60 s do anterior', () => {
    const plans = planChunks(60 * MIN)
    expect(plans.map((p) => [p.startMs, p.endMs])).toEqual([
      [0, 20 * MIN],
      [20 * MIN - OVERLAP_MS, 40 * MIN],
      [40 * MIN - OVERLAP_MS, 60 * MIN]
    ])
  })

  it('56 min viram 3 blocos de 18:40 (iguais, sem sobra minúscula)', () => {
    const plans = planChunks(56 * MIN)
    expect(plans.map((p) => p.endMs - p.startMs)).toEqual([
      18 * MIN + 40_000,
      18 * MIN + 40_000 + OVERLAP_MS,
      18 * MIN + 40_000 + OVERLAP_MS
    ])
  })

  it('cada Instante pertence a exatamente um bloco (as emendas ficam no meio da sobreposição)', () => {
    const plans = planChunks(50 * MIN + 1234)
    expect(plans[0]?.ownFromMs).toBe(0)
    expect(plans.at(-1)?.ownToMs).toBe(Number.POSITIVE_INFINITY)
    for (let i = 1; i < plans.length; i++) {
      const previous = plans[i - 1]!
      const plan = plans[i]!
      expect(plan.ownFromMs).toBe(previous.ownToMs)
      expect(plan.ownFromMs).toBeGreaterThan(plan.startMs)
      expect(plan.ownFromMs).toBeLessThan(previous.endMs)
    }
    // O bloco final termina exatamente no fim da Reunião.
    expect(plans.at(-1)?.endMs).toBe(50 * MIN + 1234)
  })
})

describe('planChunks com o modelo dedicado de transcrição', () => {
  it('até 25 min vai inteira num bloco só', () => {
    expect(planChunks(25 * MIN, 'transcribe')).toHaveLength(1)
    expect(planChunks(25 * MIN + 1000, 'transcribe')).toHaveLength(2)
    expect(planChunks(24.5 * MIN)).toHaveLength(2)
    expect(planChunks(24.5 * MIN, 'transcribe')).toHaveLength(1)
  })

  it('nenhum áudio enviado passa de ~25 min (cabe nos 30 min com separação de vozes)', () => {
    for (const total of [26, 40, 56, 60, 90, 180]) {
      for (const plan of planChunks(total * MIN, 'transcribe')) {
        expect(chunkDurationMs(plan)).toBeLessThanOrEqual(25 * MIN + 1)
      }
    }
  })

  it('1 hora vira 3 blocos de 20 min, com a mesma sobreposição de 60 s', () => {
    const plans = planChunks(60 * MIN, 'transcribe')
    expect(plans.map((p) => [p.startMs, p.endMs])).toEqual([
      [0, 20 * MIN],
      [20 * MIN - OVERLAP_MS, 40 * MIN],
      [40 * MIN - OVERLAP_MS, 60 * MIN]
    ])
  })

  it('sem informar o motor, vale o plano dos modelos de uso geral', () => {
    expect(planChunks(56 * MIN)).toEqual(planChunks(56 * MIN, 'generate'))
  })
})

describe('matchesPlan', () => {
  it('aceita o mesmo trecho (com folga de 1 s) e recusa outro', () => {
    const [plan] = planChunks(10 * MIN)
    expect(matchesPlan({ startMs: 0, endMs: 10 * MIN + 500 }, plan!)).toBe(true)
    expect(matchesPlan({ startMs: 0, endMs: 12 * MIN }, plan!)).toBe(false)
  })
})
