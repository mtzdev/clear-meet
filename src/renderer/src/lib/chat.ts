import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, ChatPending, ChatSent } from '@shared/chat'
import type { Result } from '@shared/recording'

export interface ChatController<M extends ChatMessage = ChatMessage> {
  loaded: boolean
  loadError: string | null
  messages: M[]
  /** Resposta em geração, com o texto que já chegou. */
  pending: { id: string; text: string } | null
  /** Erro da última resposta (a pergunta continua no histórico). */
  failure: string | null
  send: (text: string) => Promise<string | null>
  retry: () => Promise<string | null>
  stop: () => void
  clear: () => Promise<string | null>
}

/** Eventos de uma Conversa, já sem o identificador da Reunião ou do grupo. */
export type ChatStreamEvent<M extends ChatMessage> =
  | { type: 'delta'; messageId: string; text: string }
  | { type: 'done'; messageId: string; message: M | null }
  | { type: 'error'; messageId: string; message: string }

/** Como uma Conversa fala com o main; o objeto precisa ser estável (use `useMemo`). */
export interface ChatAdapter<M extends ChatMessage> {
  load(): Promise<Result<{ messages: M[]; pending: ChatPending | null }>>
  send(text: string | null): Promise<Result<ChatSent>>
  stop(): void
  clear(): Promise<Result<null>>
  subscribe(handler: (event: ChatStreamEvent<M>) => void): () => void
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Estado de uma Conversa. As respostas chegam por eventos do main; um evento pode vir antes de
 * o `send` responder, então o texto de respostas ainda desconhecidas fica guardado à parte.
 */
export function useChatSession<M extends ChatMessage>(adapter: ChatAdapter<M>): ChatController<M> {
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [messages, setMessages] = useState<M[]>([])
  const [pending, setPending] = useState<{ id: string; text: string } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const pendingId = useRef<string | null>(null)
  const early = useRef(new Map<string, string>())
  /** Respostas que terminaram antes de o `send` voltar. */
  const finished = useRef(new Set<string>())

  const track = useCallback((id: string | null, text = ''): void => {
    pendingId.current = id
    setPending(id ? { id, text: (early.current.get(id) ?? '') + text } : null)
    if (id) early.current.delete(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    adapter.load().then(
      (result) => {
        if (cancelled) return
        if (!result.ok) {
          setLoadError(result.error.message)
        } else {
          setMessages(result.value.messages)
          if (result.value.pending) track(result.value.pending.messageId, result.value.pending.text)
          else track(null)
        }
        setLoaded(true)
      },
      (error: unknown) => {
        if (cancelled) return
        setLoadError(errorText(error))
        setLoaded(true)
      }
    )
    return () => {
      cancelled = true
    }
  }, [adapter, track])

  useEffect(
    () =>
      adapter.subscribe((event) => {
        if (event.type === 'delta') {
          if (pendingId.current === event.messageId) {
            setPending((current) =>
              current && current.id === event.messageId
                ? { id: current.id, text: current.text + event.text }
                : current
            )
          } else {
            early.current.set(
              event.messageId,
              (early.current.get(event.messageId) ?? '') + event.text
            )
          }
          return
        }
        early.current.delete(event.messageId)
        if (event.type === 'done') {
          const message = event.message
          if (message) {
            setMessages((current) =>
              current.some((entry) => entry.id === message.id) ? current : [...current, message]
            )
          }
        } else {
          setFailure(event.message)
        }
        if (pendingId.current === event.messageId) track(null)
        else finished.current.add(event.messageId)
      }),
    [adapter, track]
  )

  const submit = useCallback(
    async (text: string | null): Promise<string | null> => {
      setFailure(null)
      try {
        const result = await adapter.send(text)
        if (!result.ok) return result.error.message
        const { user, assistantId } = result.value
        if (user) setMessages((current) => [...current, user as M])
        if (!finished.current.delete(assistantId)) track(assistantId)
        return null
      } catch (error) {
        return errorText(error)
      }
    },
    [adapter, track]
  )

  const clear = useCallback(async (): Promise<string | null> => {
    try {
      const result = await adapter.clear()
      if (!result.ok) return result.error.message
      setMessages([])
      setFailure(null)
      track(null)
      return null
    } catch (error) {
      return errorText(error)
    }
  }, [adapter, track])

  return {
    loaded,
    loadError,
    messages,
    pending,
    failure,
    send: (text) => submit(text),
    retry: () => submit(null),
    stop: () => adapter.stop(),
    clear
  }
}

/** Conversa de uma Reunião. */
export function useChat(folder: string, meetingId: string): ChatController {
  const adapter = useMemo<ChatAdapter<ChatMessage>>(
    () => ({
      load: () => window.api.invoke('chat:get', { folder }),
      send: (text) => window.api.invoke('chat:send', { folder, text }),
      stop: () => void window.api.invoke('chat:stop', { folder }),
      clear: () => window.api.invoke('chat:clear', { folder }),
      subscribe: (handler) =>
        window.api.on('chat:event', (event) => {
          if (event.meetingId === meetingId) handler(event)
        })
    }),
    [folder, meetingId]
  )
  return useChatSession(adapter)
}
