import { useCallback, useEffect, useRef, useState } from 'react'
import { clockElapsedMs, type ClockSnapshot } from '@shared/clock'
import {
  IDLE_STATE,
  type AudioLevels,
  type CaptureSourceInfo,
  type PreflightInfo,
  type RecordingState,
  type RecoveryReport
} from '@shared/recording'
import type { SettingsPatch, SettingsView } from '@shared/settings'
import { smoothLevel } from './audio-level'

/** Estado da gravação, vindo do main: consulta inicial + eventos. */
export function useRecordingState(): RecordingState {
  const [state, setState] = useState<RecordingState>(IDLE_STATE)
  useEffect(() => {
    let cancelled = false
    const off = window.api.on('recording:state', setState)
    void window.api.invoke('recording:getState').then((initial) => {
      if (!cancelled) setState((current) => (current === IDLE_STATE ? initial : current))
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])
  return state
}

/** Tempo gravado (ms), recalculado 4 vezes por segundo a partir do relógio do main. */
export function useElapsedMs(clock: ClockSnapshot | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!clock) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [clock])
  return clock ? clockElapsedMs(clock, Math.max(now, clock.startedAt)) : 0
}

/** Níveis de áudio da gravação em curso (suavizados para leitura). */
export function useRecordingLevels(active: boolean): AudioLevels {
  const [levels, setLevels] = useState<AudioLevels>({ mic: 0, system: 0 })
  const last = useRef({ at: 0, mic: 0, system: 0 })
  useEffect(() => {
    if (!active) {
      last.current = { at: 0, mic: 0, system: 0 }
      return
    }
    return window.api.on('recording:level', (level) => {
      const now = performance.now()
      const elapsed = last.current.at === 0 ? 0 : now - last.current.at
      const next = {
        at: now,
        mic: smoothLevel(last.current.mic, level.mic, elapsed),
        system: smoothLevel(last.current.system, level.system, elapsed)
      }
      last.current = next
      setLevels({ mic: next.mic, system: next.system })
    })
  }, [active])
  return active ? levels : { mic: 0, system: 0 }
}

export interface SourcesQuery {
  sources: CaptureSourceInfo[]
  loading: boolean
  error: string | null
  refresh: () => void
}

/** Telas e janelas disponíveis; atualiza sozinho a cada `autoRefreshMs` enquanto `enabled`. */
export function useCaptureSources(enabled: boolean, autoRefreshMs = 8000): SourcesQuery {
  const [sources, setSources] = useState<CaptureSourceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = (): void => {
      window.api.invoke('capture:listSources').then(
        (list) => {
          if (cancelled) return
          setSources(list)
          setError(null)
          setLoading(false)
        },
        (caught: unknown) => {
          if (cancelled) return
          setError(caught instanceof Error ? caught.message : String(caught))
          setLoading(false)
        }
      )
    }
    load()
    const timer = window.setInterval(load, autoRefreshMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [enabled, autoRefreshMs, version])

  const refresh = (): void => {
    setLoading(true)
    setVersion((current) => current + 1)
  }
  return { sources, loading, error, refresh }
}

/** Espaço em disco e FFmpeg; reconsulta quando `refreshKey` muda (ex.: ao voltar a ficar ocioso). */
export function usePreflight(refreshKey: unknown): PreflightInfo | null {
  const [info, setInfo] = useState<PreflightInfo | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.api.invoke('recording:preflight').then((result) => {
      if (!cancelled) setInfo(result)
    })
    return () => {
      cancelled = true
    }
  }, [refreshKey])
  return info
}

export function useRecoveryReport(): { report: RecoveryReport; retry: () => void } {
  const [report, setReport] = useState<RecoveryReport>({
    checkedAt: null,
    running: false,
    items: []
  })
  useEffect(() => {
    let cancelled = false
    const off = window.api.on('recovery:report', setReport)
    void window.api.invoke('recovery:getReport').then((initial) => {
      if (!cancelled) setReport((current) => (current.checkedAt === null ? initial : current))
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])
  return { report, retry: () => void window.api.invoke('recovery:retry') }
}

export function useSettings(): {
  settings: SettingsView | null
  update: (patch: SettingsPatch) => void
} {
  const [settings, setSettings] = useState<SettingsView | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.api.invoke('settings:get').then((view) => {
      if (!cancelled) setSettings(view)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const update = useCallback((patch: SettingsPatch) => {
    // Atualiza na hora; o main confirma com a visão gravada.
    setSettings((current) => (current ? { ...current, ...patch } : current))
    void window.api.invoke('settings:update', patch).then(setSettings)
  }, [])
  return { settings, update }
}
