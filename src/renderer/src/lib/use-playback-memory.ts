import { useEffect } from 'react'
import type { PlayerController } from './player-controller'
import { loadPositions, rememberPosition, savePositions } from './player-prefs'

/** Intervalo para guardar a posição durante a reprodução (ms). */
const SAVE_INTERVAL_MS = 5000

/** Guarda a posição do player por Reunião: a cada poucos segundos, ao fechar e ao sair da tela. */
export function usePlaybackMemory(controller: PlayerController, meetingId: string): void {
  useEffect(() => {
    let lastMs = -1
    const save = (): void => {
      const { currentMs, durationMs } = controller.getSnapshot()
      if (currentMs === lastMs) return
      lastMs = currentMs
      savePositions(rememberPosition(loadPositions(), meetingId, currentMs, durationMs, Date.now()))
    }
    const timer = window.setInterval(save, SAVE_INTERVAL_MS)
    window.addEventListener('pagehide', save)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', save)
      save()
    }
  }, [controller, meetingId])
}
