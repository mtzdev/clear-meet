import { useCallback, useEffect, useRef, useState } from 'react'
import { settle } from '@/lib/tags'
import type { GroupInfo, GroupsOverview } from '@shared/groups'

const CHANGE_DEBOUNCE_MS = 200

export interface GroupsState {
  /** Grupos, sugestões e se dá para editar; `null` até a primeira resposta. */
  overview: GroupsOverview | null
  reload: () => void
  /** Testa de novo se a pasta das Reuniões aceita gravar a definição dos grupos. */
  recheck: () => void
}

/** Grupos, relidos quando o índice da Biblioteca avisa que algo mudou. */
export function useGroups(): GroupsState {
  const [overview, setOverview] = useState<GroupsOverview | null>(null)
  const [version, setVersion] = useState(0)
  const recheckNext = useRef(false)
  const latest = useRef(0)

  useEffect(() => {
    const request = ++latest.current
    const recheck = recheckNext.current
    recheckNext.current = false
    window.api.invoke('groups:list', { recheck }).then(
      (result) => {
        if (request === latest.current) setOverview(result)
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
  const recheck = useCallback(() => {
    recheckNext.current = true
    setVersion((current) => current + 1)
  }, [])
  return { overview, reload, recheck }
}

export function findGroup(overview: GroupsOverview | null, id: string | null): GroupInfo | null {
  if (overview === null || id === null) return null
  return overview.groups.find((group) => group.id === id) ?? null
}

/** Põe as Reuniões no grupo (ou tira, com `null`). Devolve a mensagem de erro ou `null`. */
export async function moveToGroup(
  folders: readonly string[],
  groupId: string | null
): Promise<string | null> {
  const result = await settle(
    window.api.invoke('groups:setGroup', { folders: [...folders], groupId })
  )
  return result.ok ? null : result.error.message
}

export function meetingCountText(count: number): string {
  return count === 1 ? '1 Reunião' : `${count} Reuniões`
}

/**
 * Grupo atual de uma Reunião, relido quando o índice muda (o fim da gravação atribui o grupo em
 * segundo plano). `null` até saber e para "sem grupo".
 */
export function useMeetingGroupId(meetingId: string): string | null {
  const [groupId, setGroupId] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    window.api.invoke('meeting:get', { id: meetingId }).then(
      (result) => {
        if (!cancelled && result.ok) setGroupId(result.value.groupId)
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [meetingId, version])

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

  return groupId
}
