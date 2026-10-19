import { useEffect, useState } from 'react'
import type { ContentArea } from '@shared/content-area'

/**
 * Área útil do Vídeo (sem as faixas pretas gravadas), pedida ao main em segundo plano: a Reunião
 * abre normal e o player reenquadra quando a medida chega. `version` muda quando o arquivo
 * do Vídeo pode ter sido trocado (Compactação).
 */
export function useContentArea(
  folder: string,
  enabled: boolean,
  version: string
): ContentArea | null {
  const key = `${folder}|${version}`
  const [result, setResult] = useState<{ key: string; area: ContentArea | null } | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    window.api
      .invoke('video:contentArea', { folder })
      .then((area) => {
        if (!cancelled) setResult({ key, area })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [folder, enabled, key])

  return result?.key === key ? result.area : null
}
