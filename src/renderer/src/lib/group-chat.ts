import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChatSession, type ChatAdapter, type ChatController } from '@/lib/chat'
import type { GroupChatMessage, GroupScope, ScopeCandidate, ScopeRef } from '@shared/group-chat'

const CHANGE_DEBOUNCE_MS = 200

export type GroupChatController = ChatController<GroupChatMessage> & {
  /** Reuniões da resposta em geração: as citações viram links já durante a geração. */
  pendingScope: ScopeRef[]
}

/** Conversa de um grupo. */
export function useGroupChat(groupId: string): GroupChatController {
  const [pendingScope, setPendingScope] = useState<ScopeRef[]>([])
  const adapter = useMemo<ChatAdapter<GroupChatMessage>>(
    () => ({
      load: async () => {
        const result = await window.api.invoke('groupChat:get', { groupId })
        if (result.ok) setPendingScope(result.value.pendingScope)
        return result
      },
      send: async (text) => {
        const result = await window.api.invoke('groupChat:send', { groupId, text })
        if (result.ok) setPendingScope(result.value.scope)
        return result
      },
      stop: () => void window.api.invoke('groupChat:stop', { groupId }),
      clear: () => window.api.invoke('groupChat:clear', { groupId }),
      subscribe: (handler) =>
        window.api.on('groupChat:event', (event) => {
          if (event.groupId === groupId) handler(event)
        })
    }),
    [groupId]
  )
  return { ...useChatSession(adapter), pendingScope }
}

export interface GroupScopeState {
  /** Escopo escolhido; `null` até carregar. */
  scope: GroupScope | null
  /** Reuniões do grupo que o escopo pode pegar; `null` até carregar. */
  meetings: ScopeCandidate[] | null
  /** Momento (ms) da última leitura: o período do escopo conta a partir dele. */
  nowMs: number
  /** Guarda o escopo; devolve a mensagem de erro ou `null`. */
  save: (scope: GroupScope) => Promise<string | null>
}

/**
 * Escopo das perguntas de um grupo e as Reuniões dele, relidos quando o índice da Biblioteca
 * muda (Transcrição que termina, Reunião movida de grupo).
 */
export function useGroupScope(groupId: string): GroupScopeState {
  const [scope, setScope] = useState<GroupScope | null>(null)
  const [meetings, setMeetings] = useState<ScopeCandidate[] | null>(null)
  const [nowMs, setNowMs] = useState(0)
  const [version, setVersion] = useState(0)
  const latest = useRef(0)

  useEffect(() => {
    const request = ++latest.current
    void Promise.all([
      window.api.invoke('groupChat:get', { groupId }),
      window.api.invoke('groupChat:meetings', { groupId })
    ]).then(
      ([state, list]) => {
        if (request !== latest.current) return
        if (state.ok) setScope((current) => current ?? state.value.scope)
        if (list.ok) setMeetings(list.value)
        setNowMs(Date.now())
      },
      () => undefined
    )
  }, [groupId, version])

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

  const save = useCallback(
    async (next: GroupScope): Promise<string | null> => {
      setScope(next)
      try {
        const result = await window.api.invoke('groupChat:setScope', { groupId, scope: next })
        if (!result.ok) return result.error.message
        setScope(result.value)
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
    [groupId]
  )

  return { scope, meetings, nowMs, save }
}
