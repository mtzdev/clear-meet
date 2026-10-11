/**
 * Relógio da gravação: conta só o tempo gravado (pausas não entram). É a base dos
 * Instantes (CONTEXT.md). Funções puras sobre um snapshot serializável, para o main
 * calcular e a UI exibir o tempo decorrido sem trocar mensagens a cada segundo.
 */
export interface ClockSnapshot {
  /** Tempo (ms desde 1970) do Instante zero: início do gravador de **áudio**. */
  startedAt: number
  /** Tempo gravado nos trechos já encerrados por pausas. */
  accumulatedMs: number
  /** Início do trecho em andamento; `null` enquanto pausado. */
  resumedAt: number | null
}

export function clockStart(at: number): ClockSnapshot {
  return { startedAt: at, accumulatedMs: 0, resumedAt: at }
}

export function isClockRunning(clock: ClockSnapshot): boolean {
  return clock.resumedAt !== null
}

export function clockPause(clock: ClockSnapshot, at: number): ClockSnapshot {
  if (clock.resumedAt === null) return clock
  return {
    ...clock,
    accumulatedMs: clock.accumulatedMs + Math.max(0, at - clock.resumedAt),
    resumedAt: null
  }
}

export function clockResume(clock: ClockSnapshot, at: number): ClockSnapshot {
  if (clock.resumedAt !== null) return clock
  return { ...clock, resumedAt: at }
}

/** Instante (ms de gravação) correspondente ao tempo `now`; nunca negativo. */
export function clockElapsedMs(clock: ClockSnapshot, now: number): number {
  const running = clock.resumedAt === null ? 0 : Math.max(0, now - clock.resumedAt)
  return clock.accumulatedMs + running
}

/** `75_000` -> `01:15`; a partir de 1 h, `1:01:15`. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}
