import { useCallback, useEffect, useState } from 'react'
import type { AiStatus } from '@shared/ai'

export interface AiStatusQuery {
  status: AiStatus | null
  /** Substitui o estado depois de salvar ou remover uma chave. */
  set: (status: AiStatus) => void
  reload: () => void
}

/** Chaves configuradas (sem os valores) e se o armazenamento seguro do Windows está disponível. */
export function useAiStatus(): AiStatusQuery {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let cancelled = false
    void window.api.invoke('ai:getStatus').then((next) => {
      if (!cancelled) setStatus(next)
    })
    return () => {
      cancelled = true
    }
  }, [version])
  const reload = useCallback(() => setVersion((current) => current + 1), [])
  return { status, set: setStatus, reload }
}

/** Abre no navegador um dos links permitidos (o main recusa qualquer outro). */
export function openExternal(url: string): void {
  void window.api.invoke('app:openExternal', { url })
}
