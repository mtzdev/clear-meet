import { useCallback, useEffect, useState } from 'react'

/** Tela cheia de um elemento (o player inteiro, para manter os controles). Esc sai. */
export function useFullscreen(element: HTMLElement | null): {
  active: boolean
  toggle: () => void
} {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const onChange = (): void =>
      setActive(element !== null && document.fullscreenElement === element)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [element])

  const toggle = useCallback((): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
    } else {
      void element?.requestFullscreen().catch(() => undefined)
    }
  }, [element])

  return { active, toggle }
}
