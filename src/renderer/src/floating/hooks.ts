import { useEffect, useRef, useState, type RefObject } from 'react'
import { DEFAULT_NOTE_SHORTCUT } from '@shared/notes'
import type { FloatingInfo } from '@shared/floating'

const SAVED_TOAST_MS = 2500

/** Atalho das Anotações e se ele foi registrado: consulta inicial + eventos. */
export function useFloatingInfo(): FloatingInfo {
  const [info, setInfo] = useState<FloatingInfo>({
    shortcut: DEFAULT_NOTE_SHORTCUT,
    shortcutRegistered: true
  })
  useEffect(() => {
    let cancelled = false
    const off = window.api.on('floating:info', setInfo)
    void window.api.invoke('floating:getInfo').then((initial) => {
      if (!cancelled) setInfo(initial)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])
  return info
}

/** Instante (ms) da última Anotação salva, enquanto o aviso "Anotação salva" deve aparecer. */
export function useNoteSavedToast(): number | null {
  const [offsetMs, setOffsetMs] = useState<number | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    const off = window.api.on('notes:saved', (event) => {
      setOffsetMs(event.offsetMs)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setOffsetMs(null), SAVED_TOAST_MS)
    })
    return () => {
      off()
      window.clearTimeout(timer.current)
    }
  }, [])
  return offsetMs
}

/**
 * A janela da barra tem tamanho fixo na largura e a altura do conteúdo: avisa o main sempre
 * que o conteúdo muda de altura (linha de avisos, "Anotação salva").
 */
export function useReportHeight(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let last = 0
    const report = (): void => {
      const height = Math.ceil(element.getBoundingClientRect().height)
      if (height === last) return
      last = height
      void window.api.invoke('floating:resize', { height })
    }
    const observer = new ResizeObserver(report)
    observer.observe(element)
    report()
    return () => observer.disconnect()
  }, [ref])
}
