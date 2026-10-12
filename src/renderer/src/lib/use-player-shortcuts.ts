import { useEffect } from 'react'
import { SEEK_STEP_MS } from '@shared/timeline'
import type { PlayerController } from './player-controller'
import { isInsideOverlay, isTextEntry, playerKeyAction, type ElementLike } from './player-keys'

/**
 * Espaço (tocar/pausar) e ←/→ (±5 s) na tela da Reunião, exceto quando o foco está num
 * campo de texto ou num menu/diálogo. O espaço no teclado também "clica" no botão focado ao
 * soltar a tecla; por isso o `keyup` do espaço tratado também é cancelado.
 */
export function usePlayerShortcuts(controller: PlayerController, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return

    const actionFor = (event: KeyboardEvent): ReturnType<typeof playerKeyAction> => {
      const target = event.target as ElementLike | null
      return playerKeyAction(event.key, {
        inTextField: isTextEntry(target),
        inOverlay: isInsideOverlay(target),
        modified: event.ctrlKey || event.altKey || event.metaKey
      })
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      const action = actionFor(event)
      if (!action) return
      event.preventDefault()
      if (action === 'toggle') {
        if (!event.repeat) controller.togglePlay()
      } else {
        controller.skip(action === 'back' ? -SEEK_STEP_MS : SEEK_STEP_MS)
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
