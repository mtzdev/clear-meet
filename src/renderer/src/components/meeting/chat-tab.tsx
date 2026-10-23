import { MessageCircleQuestion } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { ChatPanel } from '@/components/chat/chat-panel'
import { RichText } from '@/components/meeting/rich-text'
import { Button } from '@/components/ui/button'
import { useAiStatus } from '@/lib/ai'
import { useChat } from '@/lib/chat'
import type { PlayerController } from '@/lib/player-controller'
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
  const onSeek = (ms: number): void => controller.seekToMs(ms)
  return (
    <ChatPanel
      controller={chat}
      title="Pergunte sobre a Reunião"
      description="A IA responde com base na Transcrição e indica o Instante de cada trecho."
      suggestions={SUGGESTIONS}
      inputLabel="Pergunta sobre a Reunião"
      placeholder="Pergunte algo sobre a Reunião"
      renderAnswer={(message) => (
        <RichText text={message.text} durationMs={durationMs} onSeek={onSeek} />
      )}
      renderPending={(text) => <RichText text={text} durationMs={durationMs} onSeek={onSeek} />}
    />
  )
}
