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
import { knownThumbnails, mergeSources } from './source-merge'

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

/** Visibilidade e foco da janela: minimizada, oculta ou sem foco não precisa atualizar a lista. */
function useWindowActivity(): { visible: boolean; focused: boolean } {
  const read = (): { visible: boolean; focused: boolean } => ({
    visible: document.visibilityState === 'visible',
    focused: document.hasFocus()
  })
  const [activity, setActivity] = useState(read)
  useEffect(() => {
    const update = (): void => {
      const next = read()
      setActivity((current) =>
        current.visible === next.visible && current.focused === next.focused ? current : next
      )
    }
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    update()
    return () => {
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
    }
  }, [])
  return activity
}

/**
 * Telas e janelas disponíveis. Enquanto `enabled` e a janela estiver visível e em foco, consulta
 * o main `intervalMs` depois do fim da consulta anterior (nunca duas ao mesmo tempo) e junta o
 * resultado ao que já existe, sem trocar o que não mudou.
 */
export function useCaptureSources(enabled: boolean, intervalMs = 5000): SourcesQuery {
  const [sources, setSources] = useState<CaptureSourceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const { visible, focused } = useWindowActivity()
  // A primeira consulta não espera o foco; depois disso, só com a janela visível e em foco.
  const active = enabled && visible && (focused || !loaded)
  const known = useRef<Record<string, string>>({})
  const forceNext = useRef(false)
  const runNow = useRef<() => void>(() => undefined)

  useEffect(() => {
    known.current = knownThumbnails(sources)
  }, [sources])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let inFlight = false
    let timer = 0
    const run = (): void => {
      if (inFlight) return
      inFlight = true
      window.clearTimeout(timer)
      const force = forceNext.current
      forceNext.current = false
      window.api
        .invoke('capture:listSources', {
          known: known.current,
          thumbnailWidth: Math.round(240 * (window.devicePixelRatio || 1)),
          force
        })
        .then(
          (list) => {
            if (cancelled) return
            setSources((current) => mergeSources(current, list))
            setError(null)
          },
          (caught: unknown) => {
            if (cancelled) return
            setError(caught instanceof Error ? caught.message : String(caught))
          }
        )
        .finally(() => {
          if (cancelled) return
          inFlight = false
          setLoading(false)
          setLoaded(true)
          timer = window.setTimeout(run, intervalMs)
        })
    }
    runNow.current = run
    run()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [active, intervalMs])

  const refresh = useCallback((): void => {
    forceNext.current = true
    setLoading(true)
    runNow.current()
  }, [])
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
  /** Troca a visão local (depois de um canal próprio que já devolve as configurações). */
  replace: (view: SettingsView) => void
  /** Lê as configurações de novo (ex.: depois de trocar a pasta das Reuniões). */
  reload: () => void
} {
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let cancelled = false
    void window.api.invoke('settings:get').then((view) => {
      if (!cancelled) setSettings(view)
    })
    return () => {
      cancelled = true
    }
  }, [version])
  const update = useCallback((patch: SettingsPatch) => {
    // Atualiza na hora; o main confirma com a visão gravada.
    setSettings((current) => (current ? { ...current, ...patch } : current))
    void window.api.invoke('settings:update', patch).then(setSettings)
  }, [])
  const reload = useCallback(() => setVersion((current) => current + 1), [])
  return { settings, update, replace: setSettings, reload }
}
