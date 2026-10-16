import type { TranscriptionEngine } from '@shared/ai'

/** Alvo de cada bloco de áudio enviado ao Gemini. */
export const TARGET_CHUNK_MS = 20 * 60_000
/** Até esta duração a Reunião vai inteira num bloco só. */
export const SINGLE_CHUNK_MAX_MS = 24 * 60_000
/** Quanto cada bloco (menos o primeiro) repete do final do anterior, para juntar as Falas na emenda. */
export const OVERLAP_MS = 60_000

interface ChunkLimits {
  targetMs: number
  singleMaxMs: number
}

/** O modelo dedicado aceita até 30 min de áudio com separação de vozes: bloco + sobreposição ficam em ~25 min. */
const LIMITS: Record<TranscriptionEngine, ChunkLimits> = {
  generate: { targetMs: TARGET_CHUNK_MS, singleMaxMs: SINGLE_CHUNK_MAX_MS },
  transcribe: { targetMs: 24 * 60_000, singleMaxMs: 25 * 60_000 }
}

/**
 * Um bloco do Áudio da reunião. O áudio enviado vai de `startMs` a `endMs`; a Fala pertence ao
 * bloco que "é dono" do seu Instante, de `ownFromMs` (a emenda, no meio da sobreposição) até
 * `ownToMs` (a emenda seguinte; `Infinity` no último).
 */
export interface ChunkPlan {
  index: number
  startMs: number
  endMs: number
  ownFromMs: number
  ownToMs: number
}

/**
 * Divide a Reunião em blocos de tamanho parecido (nenhum maior que o alvo do motor), sem
 * sobrar um pedaço minúsculo no final. Reunião curta = 1 bloco. Duração inválida = nenhum bloco.
 */
export function planChunks(
  durationMs: number,
  engine: TranscriptionEngine = 'generate'
): ChunkPlan[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return []
  const { targetMs, singleMaxMs } = LIMITS[engine]
  const total = Math.round(durationMs)
  if (total <= singleMaxMs) {
    return [{ index: 0, startMs: 0, endMs: total, ownFromMs: 0, ownToMs: Number.POSITIVE_INFINITY }]
  }
  const count = Math.ceil(total / targetMs)
  const boundary = (i: number): number => Math.round((total * i) / count)
  const plans: ChunkPlan[] = []
  for (let i = 0; i < count; i++) {
    plans.push({
      index: i,
      startMs: i === 0 ? 0 : boundary(i) - OVERLAP_MS,
      endMs: boundary(i + 1),
      ownFromMs: i === 0 ? 0 : boundary(i) - OVERLAP_MS / 2,
      ownToMs: i === count - 1 ? Number.POSITIVE_INFINITY : boundary(i + 1) - OVERLAP_MS / 2
    })
  }
  return plans
}

/** Duração do áudio do bloco (ms). */
export function chunkDurationMs(plan: ChunkPlan): number {
  return plan.endMs - plan.startMs
}

/** O bloco salvo corresponde a este trecho do áudio? (Para reaproveitar blocos já transcritos.) */
export function matchesPlan(saved: { startMs: number; endMs: number }, plan: ChunkPlan): boolean {
  return Math.abs(saved.startMs - plan.startMs) < 1000 && Math.abs(saved.endMs - plan.endMs) < 1000
}
