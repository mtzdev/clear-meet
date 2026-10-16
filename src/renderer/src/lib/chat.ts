import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@shared/chat'

export interface ChatController {
  loaded: boolean
  loadError: string | null
  messages: ChatMessage[]
  /** Resposta em geração, com o texto que já chegou. */
  pending: { id: string; text: string } | null
  /** Erro da última resposta (a pergunta continua no histórico). */
  failure: string | null
  send: (text: string) => Promise<string | null>
  retry: () => Promise<string | null>
  stop: () => void
  clear: () => Promise<string | null>
}

/**
 * Conversa de uma Reunião. As respostas chegam por eventos do main; um evento pode vir antes
 * de o `send` responder, então o texto de respostas ainda desconhecidas fica guardado à parte.
 */
export function useChat(folder: string, meetingId: string): ChatController {
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
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
    void window.api.invoke('chat:get', { folder }).then(
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
        setLoadError(error instanceof Error ? error.message : String(error))
        setLoaded(true)
      }
    )
    return () => {
      cancelled = true
    }
  }, [folder, track])

  useEffect(
    () =>
      window.api.on('chat:event', (event) => {
        if (event.meetingId !== meetingId) return
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
    [meetingId, track]
  )

  const submit = useCallback(
    async (text: string | null): Promise<string | null> => {
      setFailure(null)
      try {
        const result = await window.api.invoke('chat:send', { folder, text })
        if (!result.ok) return result.error.message
        const { user, assistantId } = result.value
        if (user) setMessages((current) => [...current, user])
        if (!finished.current.delete(assistantId)) track(assistantId)
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
    [folder, track]
  )

  const stop = useCallback(() => {
    void window.api.invoke('chat:stop', { folder })
  }, [folder])

  const clear = useCallback(async (): Promise<string | null> => {
    try {
      const result = await window.api.invoke('chat:clear', { folder })
      if (!result.ok) return result.error.message
      setMessages([])
      setFailure(null)
      track(null)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, [folder, track])

  return {
    loaded,
    loadError,
    messages,
    pending,
    failure,
    send: (text) => submit(text),
    retry: () => submit(null),
    stop,
    clear
  }
}
