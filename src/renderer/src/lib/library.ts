import { useEffect, useRef, useState } from 'react'
import type { LibraryQuery, LibraryResult } from '@shared/library'

/** Espera depois do último aviso do índice antes de consultar de novo (avisos vêm em rajada). */
const CHANGE_DEBOUNCE_MS = 200

export interface LibraryQueryState {
  /** Último resultado recebido; continua na tela enquanto uma nova consulta carrega. */
  data: LibraryResult | null
  /** Ainda não chegou nenhum resultado. */
  loading: boolean
  error: string | null
  reload: () => void
}

/** Valor que só muda depois de `delayMs` sem novas alterações. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

/**
 * Consulta a Biblioteca e a refaz quando o índice avisa que mudou. Respostas de consultas
 * antigas são descartadas.
 */
export function useLibraryQuery(query: LibraryQuery): LibraryQueryState {
  const [data, setData] = useState<LibraryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const latest = useRef(0)

  const { text, groupId, fromMs, toMs, sort, limit } = query
  // A lista de Tags vira texto para a consulta só se repetir quando o filtro muda de verdade.
  const tagsKey = query.tags.join('\u0000')

  useEffect(() => {
    const request = ++latest.current
    window.api
      .invoke('library:search', {
        text,
        tags: tagsKey === '' ? [] : tagsKey.split('\u0000'),
        fromMs,
        toMs,
        sort,
        limit,
        groupId
      })
      .then(
        (result) => {
          if (request !== latest.current) return
          setData(result)
          setError(null)
        },
        (failure: unknown) => {
          if (request !== latest.current) return
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      )
  }, [text, tagsKey, groupId, fromMs, toMs, sort, limit, version])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.api.on('library:changed', () => {
      clearTimeout(timer)
      timer = setTimeout(() => setVersion((current) => current + 1), CHANGE_DEBOUNCE_MS)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [])

  return {
    data,
    loading: data === null && error === null,
    error,
    reload: () => setVersion((current) => current + 1)
  }
}
