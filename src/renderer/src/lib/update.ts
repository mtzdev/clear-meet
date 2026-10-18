import { useEffect, useState } from 'react'
import { UNAVAILABLE_UPDATE_STATE, type UpdateState } from '@shared/update'

/** Estado da atualização automática, vindo do main: consulta inicial + eventos. */
export function useUpdateState(): UpdateState {
  const [state, setState] = useState<UpdateState>(UNAVAILABLE_UPDATE_STATE)
  useEffect(() => {
    let cancelled = false
    const off = window.api.on('update:changed', setState)
    void window.api.invoke('update:getState').then((initial) => {
      if (!cancelled)
        setState((current) => (current === UNAVAILABLE_UPDATE_STATE ? initial : current))
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])
  return state
}
