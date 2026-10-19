import { useEffect, useState } from 'react'
import type { Size } from './player-view'

const EMPTY: Size = { width: 0, height: 0 }

/** Tamanho de um elemento (px), acompanhando o redimensionamento. */
export function useElementSize(element: HTMLElement | null): Size {
  const [size, setSize] = useState<Size>(EMPTY)

  useEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height }
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return size
}
