import {
  ArrowUp,
  LoaderCircle,
  MessageCircleQuestion,
  Square,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { EmptyState } from '@/components/empty-state'
import { RichText } from '@/components/meeting/rich-text'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useAiStatus } from '@/lib/ai'
import { useChat } from '@/lib/chat'
import type { PlayerController } from '@/lib/player-controller'
import { AI_PROVIDER_LABEL } from '@shared/ai'
import { MAX_QUESTION_LENGTH, type ChatMessage } from '@shared/chat'
import type { TranscriptView } from '@shared/transcript'

const SUGGESTIONS = [
  'Quais foram as decisões?',
  'O que ficou para mim?',
  'Quais são os próximos passos?',
  'Qual foi o principal ponto de discordância?'
]

interface ChatTabProps {
  folder: string
  meetingId: string
  durationMs: number | null
  /** A Reunião ainda está sendo gravada ou processada. */
  locked: boolean
  transcript: TranscriptView
  controller: PlayerController
}

export function ChatTab({
  folder,
  meetingId,
  durationMs,
  locked,
  transcript,
  controller
}: ChatTabProps) {
  const ai = useAiStatus()
  const hasTextKey = ai.status
    ? ai.status.keys.gemini.configured || ai.status.keys.groq.configured
    : true

  if (locked || transcript.status !== 'ready') {
    return (
      <EmptyState
        icon={MessageCircleQuestion}
        title={
          transcript.status === 'running'
            ? 'Aguardando a Transcrição'
            : 'As perguntas precisam da Transcrição'
        }
        description={
          locked
            ? 'Disponível quando a Reunião terminar de ser gravada.'
            : transcript.status === 'running'
              ? 'Quando a Transcrição terminar, você poderá perguntar sobre esta Reunião.'
              : 'Gere a Transcrição primeiro para poder perguntar.'
        }
      />
    )
  }
  if (!hasTextKey) {
    return (
      <EmptyState
        icon={MessageCircleQuestion}
        title="Falta uma chave de IA"
        description="As respostas vêm do Gemini ou da Groq, com a sua chave."
        action={
          <Button asChild>
            <a href="#/settings">Configurar uma chave de IA</a>
          </Button>
        }
      />
    )
  }
  return (
    <Conversation
      key={folder}
      folder={folder}
      meetingId={meetingId}
      durationMs={durationMs}
      controller={controller}
    />
  )
}

function MessageView({
  message,
  durationMs,
  onSeek
}: {
  message: ChatMessage
  durationMs: number | null
  onSeek: (ms: number) => void
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-sm whitespace-pre-wrap break-words">
          {message.text}
        </p>
      </div>
    )
  }
  return (
    <div className="max-w-[92%] space-y-1">
      <RichText text={message.text} durationMs={durationMs} onSeek={onSeek} />
      <p className="text-muted-foreground text-[11px]">
        {message.stopped && 'Resposta interrompida. '}
        {message.provider &&
          `${AI_PROVIDER_LABEL[message.provider]}${message.model ? ` · ${message.model}` : ''}`}
      </p>
    </div>
  )
}

function Conversation({
  folder,
  meetingId,
  durationMs,
  controller
}: {
  folder: string
  meetingId: string
  durationMs: number | null
  controller: PlayerController
}) {
  const chat = useChat(folder, meetingId)
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const busy = chat.pending !== null
  const onSeek = (ms: number): void => controller.seekToMs(ms)

  useEffect(() => {
    const list = listRef.current
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight
  }, [chat.messages.length, chat.pending?.text, chat.failure])

  const submit = async (text: string): Promise<void> => {
    const question = text.trim()
    if (question === '' || busy) return
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
              <Button size="xs" variant="outline" onClick={() => void clear()}>
                Limpar conversa
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancelar
              </Button>
            </span>
          ) : (
            <Button size="xs" variant="ghost" onClick={() => setConfirmClear(true)}>
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
              <h2 className="text-base font-semibold tracking-tight">Pergunte sobre a Reunião</h2>
              <p className="text-muted-foreground text-sm text-balance">
                A IA responde com base na Transcrição e indica o Instante de cada trecho.
              </p>
            </div>
            <div className="flex max-w-sm flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  size="sm"
                  variant="outline"
                  className="h-auto py-1.5 whitespace-normal"
                  onClick={() => void submit(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        )}
        {chat.messages.map((message) => (
          <MessageView key={message.id} message={message} durationMs={durationMs} onSeek={onSeek} />
        ))}
        {chat.pending && (
          <div className="max-w-[92%]" aria-live="polite">
            {chat.pending.text === '' ? (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                Pensando…
              </p>
            ) : (
              <RichText text={chat.pending.text} durationMs={durationMs} onSeek={onSeek} />
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
              <Button size="xs" variant="outline" onClick={() => void retry()}>
                Tentar de novo
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="border-border shrink-0 space-y-1.5 border-t p-3">
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
            aria-label="Pergunta sobre a Reunião"
            placeholder="Pergunte algo sobre a Reunião"
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
              disabled={draft.trim() === ''}
              onClick={() => void submit(draft)}
            >
              <ArrowUp aria-hidden />
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-[11px]">
          Enter envia · Shift+Enter quebra a linha
        </p>
      </div>
    </div>
  )
}
