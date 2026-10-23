import {
  ArrowUp,
  LoaderCircle,
  MessageCircleQuestion,
  Square,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { ChatController } from '@/lib/chat'
import { AI_PROVIDER_LABEL } from '@shared/ai'
import { MAX_QUESTION_LENGTH, type ChatMessage } from '@shared/chat'

export interface ChatPanelProps<M extends ChatMessage> {
  controller: ChatController<M>
  title: string
  description?: string
  suggestions: readonly string[]
  inputLabel: string
  placeholder: string
  /** O texto da resposta (com citações clicáveis); o rodapé com o provedor é do painel. */
  renderAnswer: (message: M) => ReactNode
  renderPending: (text: string) => ReactNode
  /** Linha discreta ao lado da dica do campo (o escopo da pergunta). */
  composerInfo?: ReactNode
  /** Quando preenchido, não dá para perguntar; o texto aparece no lugar do campo. */
  blockedReason?: string | null
}

/** Linha discreta de uma resposta: interrompida, provedor e modelo. */
export function AnswerFooter({ message }: { message: ChatMessage }) {
  return (
    <p className="text-muted-foreground text-[11px]">
      {message.stopped && 'Resposta interrompida. '}
      {message.provider &&
        `${AI_PROVIDER_LABEL[message.provider]}${message.model ? ` · ${message.model}` : ''}`}
    </p>
  )
}

function QuestionBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <p className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-sm whitespace-pre-wrap break-words">
        {message.text}
      </p>
    </div>
  )
}

/** Conversa com a IA: lista de mensagens, resposta em geração, erro, campo e botões. */
export function ChatPanel<M extends ChatMessage>({
  controller: chat,
  title,
  description,
  suggestions,
  inputLabel,
  placeholder,
  renderAnswer,
  renderPending,
  composerInfo,
  blockedReason = null
}: ChatPanelProps<M>) {
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const busy = chat.pending !== null
  const blocked = blockedReason !== null

  useEffect(() => {
    const list = listRef.current
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight
  }, [chat.messages.length, chat.pending?.text, chat.failure])

  const submit = async (text: string): Promise<void> => {
    const question = text.trim()
    if (question === '' || busy || blocked) return
    stickToBottom.current = true
    setSendError(null)
    const failure = await chat.send(question)
    if (failure) setSendError(failure)
    else setDraft('')
  }

  const retry = async (): Promise<void> => {
    stickToBottom.current = true
    setSendError(await chat.retry())
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit(draft)
    }
  }

  const clear = async (): Promise<void> => {
    setConfirmClear(false)
    setSendError(await chat.clear())
  }

  if (!chat.loaded) {
    return (
      <div className="text-muted-foreground grid h-full place-items-center">
        <LoaderCircle className="size-5 animate-spin" aria-label="Carregando a Conversa" />
      </div>
    )
  }

  const empty = chat.messages.length === 0 && !chat.pending
  const lastIsQuestion = chat.messages[chat.messages.length - 1]?.role === 'user'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!empty && (
        <div className="border-border flex shrink-0 items-center justify-end border-b px-3 py-1.5">
          {confirmClear ? (
            <span className="flex flex-wrap items-center justify-end gap-1 text-xs">
              <span className="text-muted-foreground">Apagar toda a Conversa?</span>
              <Button size="xs" variant="outline" disabled={blocked} onClick={() => void clear()}>
                Limpar conversa
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancelar
              </Button>
            </span>
          ) : (
            <Button
              size="xs"
              variant="ghost"
              disabled={blocked}
              onClick={() => setConfirmClear(true)}
            >
              <Trash2 aria-hidden />
              Limpar conversa
            </Button>
          )}
        </div>
      )}

      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
        onScroll={(event) => {
          const list = event.currentTarget
          stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48
        }}
      >
        {chat.loadError && (
          <p role="alert" className="text-destructive text-sm">
            {chat.loadError}
          </p>
        )}
        {empty && !chat.loadError && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="bg-accent text-accent-foreground grid size-12 place-items-center rounded-2xl">
              <MessageCircleQuestion className="size-5" aria-hidden />
            </div>
            <div className="max-w-xs space-y-1">
              <h2 className="text-base font-semibold tracking-tight">{title}</h2>
              {description && (
                <p className="text-muted-foreground text-sm text-balance">{description}</p>
              )}
            </div>
            <div className="flex max-w-sm flex-wrap justify-center gap-2">
              {suggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  size="sm"
                  variant="outline"
                  disabled={blocked}
                  className="h-auto py-1.5 whitespace-normal"
                  onClick={() => void submit(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        )}
        {chat.messages.map((message) =>
          message.role === 'user' ? (
            <QuestionBubble key={message.id} message={message} />
          ) : (
            <div key={message.id} className="max-w-[92%] space-y-1">
              {renderAnswer(message)}
              <AnswerFooter message={message} />
            </div>
          )
        )}
        {chat.pending && (
          <div className="max-w-[92%]" aria-live="polite">
            {chat.pending.text === '' ? (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                Pensando…
              </p>
            ) : (
              renderPending(chat.pending.text)
            )}
          </div>
        )}
        {(chat.failure || lastIsQuestion) && !busy && (
          <div
            role="alert"
            className="border-destructive/40 text-destructive space-y-2 rounded-lg border px-3 py-2 text-sm"
          >
            <p className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {chat.failure ?? 'Esta pergunta ficou sem resposta.'}
            </p>
            {lastIsQuestion && (
              <Button size="xs" variant="outline" disabled={blocked} onClick={() => void retry()}>
                Tentar de novo
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="border-border shrink-0 space-y-1.5 border-t p-3">
        {blockedReason && <p className="text-muted-foreground text-xs">{blockedReason}</p>}
        {sendError && (
          <p role="alert" className="text-destructive text-xs">
            {sendError}
          </p>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            rows={1}
            maxLength={MAX_QUESTION_LENGTH}
            aria-label={inputLabel}
            placeholder={placeholder}
            disabled={blocked}
            className="max-h-32 min-h-10 resize-none"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {busy ? (
            <Button
              size="icon"
              variant="outline"
              aria-label="Parar a resposta"
              title="Parar a resposta"
              onClick={chat.stop}
            >
              <Square aria-hidden />
            </Button>
          ) : (
            <Button
              size="icon"
              aria-label="Enviar a pergunta"
              title="Enviar (Enter)"
              disabled={draft.trim() === '' || blocked}
              onClick={() => void submit(draft)}
            >
              <ArrowUp aria-hidden />
            </Button>
          )}
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-3 text-[11px]">
          {composerInfo ?? <span />}
          <p>Enter envia · Shift+Enter quebra a linha</p>
        </div>
      </div>
    </div>
  )
}
