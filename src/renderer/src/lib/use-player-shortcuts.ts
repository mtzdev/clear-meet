import { useEffect, useRef } from 'react'
import { LONG_SEEK_STEP_MS, SEEK_STEP_MS } from '@shared/timeline'
import type { PlayerController } from './player-controller'
import { isInsideOverlay, isTextEntry, playerKeyAction, type ElementLike } from './player-keys'

/** Ações do vídeo; faltando uma, a tecla correspondente não faz nada (Reunião só de áudio). */
export interface ViewShortcuts {
  fullscreen: () => void
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
}

/**
 * Atalhos do player na tela da Reunião, exceto quando o foco está num campo de texto ou num
 * menu/diálogo. O espaço no teclado também "clica" no botão focado ao soltar a tecla; por isso
 * o `keyup` do espaço tratado também é cancelado.
 */
export function usePlayerShortcuts(
  controller: PlayerController,
  enabled: boolean,
  view: ViewShortcuts | null
): void {
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  })

  useEffect(() => {
    if (!enabled) return

    const actionFor = (event: KeyboardEvent): ReturnType<typeof playerKeyAction> => {
      const target = event.target as ElementLike | null
      return playerKeyAction(event.key, {
        inTextField: isTextEntry(target),
        inOverlay: isInsideOverlay(target),
        modified: event.ctrlKey || event.altKey || event.metaKey,
        shift: event.shiftKey,
        paused: controller.getSnapshot().paused
      })
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      const action = actionFor(event)
      if (!action) return
      const view = viewRef.current
      // Sem vídeo, as teclas do vídeo ficam livres para o resto do app.
      if (!view && (action === 'fullscreen' || action.startsWith('zoom'))) return
      event.preventDefault()
      switch (action) {
        case 'toggle':
          if (!event.repeat) controller.togglePlay()
          break
        case 'back':
          controller.skip(-SEEK_STEP_MS)
          break
        case 'forward':
          controller.skip(SEEK_STEP_MS)
          break
        case 'back-long':
          controller.skip(-LONG_SEEK_STEP_MS)
          break
        case 'forward-long':
          controller.skip(LONG_SEEK_STEP_MS)
          break
        case 'frame-back':
          controller.stepFrame(-1)
          break
        case 'frame-forward':
          controller.stepFrame(1)
          break
        case 'mute':
          if (!event.repeat) controller.toggleMuted()
          break
        case 'fullscreen':
          if (!event.repeat) view?.fullscreen()
          break
        case 'zoom-in':
          view?.zoomIn()
          break
        case 'zoom-out':
          view?.zoomOut()
          break
        case 'zoom-reset':
          view?.zoomReset()
          break
      }
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (actionFor(event) === 'toggle') event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [controller, enabled])
}
