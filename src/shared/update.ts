import type { RecordingState } from './recording'

/**
 * `unavailable`: app fora do instalador (desenvolvimento) ou atualização desligada.
 * `idle`: nada a fazer (ainda não checou ou já está na versão mais recente).
 * `downloading`: há versão nova e ela está sendo baixada.
 * `ready`: baixada; é instalada ao fechar o app ou ao reiniciar agora.
 */
export type UpdatePhase = 'unavailable' | 'idle' | 'checking' | 'downloading' | 'ready'

export interface UpdateState {
  phase: UpdatePhase
  /** Versão nova (só em `downloading` e `ready`). */
  version: string | null
  /** Progresso do download, de 0 a 100 (só em `downloading`). */
  percent: number | null
}

export const UNAVAILABLE_UPDATE_STATE: UpdateState = {
  phase: 'unavailable',
  version: null,
  percent: null
}

export const IDLE_UPDATE_STATE: UpdateState = { phase: 'idle', version: null, percent: null }

/** Reiniciar para instalar fecha o app: nunca durante a gravação nem a finalização dela. */
export function canRestartForUpdate(recordingPhase: RecordingState['phase']): boolean {
  return recordingPhase === 'idle'
}

/** Eventos do atualizador que mudam o estado (o adaptador do `electron-updater` os produz). */
export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'not-available' }
  | { type: 'error' }

export function reduceUpdateState(state: UpdateState, event: UpdateEvent): UpdateState {
  // Depois de baixada, a atualização fica pronta até o app reiniciar; nada a desfaz.
  if (state.phase === 'ready' && event.type !== 'downloaded') return state
  switch (event.type) {
    case 'checking':
      return state.phase === 'downloading' ? state : { ...IDLE_UPDATE_STATE, phase: 'checking' }
    case 'available':
      return { phase: 'downloading', version: event.version, percent: 0 }
    case 'progress':
      return state.phase === 'downloading'
        ? { ...state, percent: Math.min(100, Math.max(0, Math.round(event.percent))) }
        : state
    case 'downloaded':
      return { phase: 'ready', version: event.version, percent: null }
    case 'not-available':
      return IDLE_UPDATE_STATE
    case 'error':
      // Uma falha na checagem volta ao repouso; um download interrompido recomeça na próxima.
      return IDLE_UPDATE_STATE
  }
}
