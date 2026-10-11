/** Menor nível mostrado no medidor (abaixo disso, a barra fica vazia). */
export const METER_FLOOR_DB = -60

/**
 * Pico (0 a 1) -> posição da barra (0 a 1) numa escala em dB, que é como o ouvido percebe
 * o volume: -60 dBFS = vazio, 0 dBFS = cheio.
 */
export function levelToFraction(peak: number): number {
  if (!(peak > 0)) return 0
  const db = 20 * Math.log10(Math.min(1, peak))
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB))
}

/**
 * Suaviza o medidor: sobe na hora e desce aos poucos (`decayPerSecond` = fração da barra
 * perdida por segundo), para o olho conseguir acompanhar.
 */
export function smoothLevel(
  previous: number,
  target: number,
  elapsedMs: number,
  decayPerSecond = 1.5
): number {
  if (target >= previous) return target
  return Math.max(target, previous - (decayPerSecond * elapsedMs) / 1000)
}
