import { useCallback, useEffect, useRef, useState } from 'react'
import type { Result } from '@shared/recording'
import type { TagInfo } from '@shared/tags'

const CHANGE_DEBOUNCE_MS = 200

export interface TagsState {
  /** Catálogo efetivo com contagem; `null` até a primeira resposta. */
  tags: TagInfo[] | null
  reload: () => void
}

/** Catálogo de Tags, relido quando o índice da Biblioteca avisa que mudou. */
export function useTags(): TagsState {
  const [tags, setTags] = useState<TagInfo[] | null>(null)
  const [version, setVersion] = useState(0)
  const latest = useRef(0)

  useEffect(() => {
    const request = ++latest.current
    window.api.invoke('tags:list').then(
      (result) => {
        if (request === latest.current) setTags(result)
      },
      () => undefined
    )
  }, [version])

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

  const reload = useCallback(() => setVersion((current) => current + 1), [])
  return { tags, reload }
}

/** Resolve o pedido de IPC como `Result`, mesmo se a chamada lançar. */
export async function settle<T>(request: Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await request
  } catch (error) {
    return {
      ok: false,
      error: { code: 'unknown', message: error instanceof Error ? error.message : String(error) }
    }
  }
}
