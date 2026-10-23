import { ChevronDown, ChevronRight, LoaderCircle, MessageCircleQuestion } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ChatPanel } from '@/components/chat/chat-panel'
import { EmptyState } from '@/components/empty-state'
import { ScopeMenu } from '@/components/groups/scope-menu'
import { RichText } from '@/components/meeting/rich-text'
import { Button } from '@/components/ui/button'
import { useAiStatus } from '@/lib/ai'
import { useGroupChat, useGroupScope } from '@/lib/group-chat'
import { meetingHref } from '@/lib/router'
import { CONTEXT_LEVEL_LABEL, resolveScope, type GroupChatMessage } from '@shared/group-chat'
import { citedMeetings } from '@shared/group-citations'

const SUGGESTIONS = [
  'O que foi decidido?',
  'Quais pendências ficaram abertas?',
  'O que mudou de uma Reunião para a outra?'
]

const READ_ONLY_REASON =
  'A pasta das Reuniões não permite gravar. A Conversa fica só para consulta.'

/** Linha discreta "Baseado em N Reuniões", que abre a lista com o que a IA recebeu de cada uma. */
function SourceLine({ message }: { message: GroupChatMessage }) {
  const [open, setOpen] = useState(false)
  const refs = message.scope
  if (!refs || refs.length === 0) return null
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="text-muted-foreground text-[11px]">
      <button
        type="button"
        aria-expanded={open}
        className="hover:text-foreground inline-flex items-center gap-0.5 rounded outline-none focus-visible:underline"
        onClick={() => setOpen((current) => !current)}
      >
        <Chevron className="size-3" aria-hidden />
        Baseado em {refs.length === 1 ? '1 Reunião' : `${refs.length} Reuniões`}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-3.5">
          {refs.map((ref) => (
            <li key={ref.id} className="flex min-w-0 gap-1.5">
              <a
                href={meetingHref(ref.id)}
                className="hover:text-foreground min-w-0 truncate underline-offset-2 hover:underline"
              >
                {ref.name}
              </a>
              <span className="shrink-0">· {CONTEXT_LEVEL_LABEL[ref.level]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface AskTabProps {
  groupId: string
  /** A pasta das Reuniões deixa gravar (a Conversa e o escopo ficam nela). */
  editable: boolean
}

/** Aba "Perguntar" do grupo: a Conversa com a IA sobre as Reuniões do escopo escolhido. */
export function AskTab({ groupId, editable }: AskTabProps) {
  const ai = useAiStatus()
  const hasTextKey = ai.status
    ? ai.status.keys.gemini.configured || ai.status.keys.groq.configured
    : true

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
  return <GroupConversation key={groupId} groupId={groupId} editable={editable} />
}

function GroupConversation({ groupId, editable }: AskTabProps) {
  const chat = useGroupChat(groupId)
  const { scope, meetings, nowMs, save } = useGroupScope(groupId)
  const [scopeError, setScopeError] = useState<string | null>(null)

  const resolution = useMemo(
    () => (scope && meetings ? resolveScope(meetings, scope, nowMs) : null),
    [scope, meetings, nowMs]
  )
  const names = useMemo(
    () => new Map((meetings ?? []).map((meeting) => [meeting.id, meeting.name])),
    [meetings]
  )

  if (!scope || !meetings || !resolution) {
    return (
      <div className="text-muted-foreground grid h-full place-items-center">
        <LoaderCircle className="size-5 animate-spin" aria-label="Carregando o escopo" />
      </div>
    )
  }
  if (meetings.length === 0) {
    return (
      <EmptyState
        icon={MessageCircleQuestion}
        title="Este grupo não tem Reuniões"
        description="Mova Reuniões para o grupo para poder perguntar sobre elas."
      />
    )
  }

  const blockedReason = !editable
    ? READ_ONLY_REASON
    : resolution.selected.length === 0
      ? 'Nenhuma Reunião do escopo tem Transcrição pronta. Ajuste o período ou o número de Reuniões.'
      : null

  const citationsFor = (message: Pick<GroupChatMessage, 'scope'>) => {
    const map = citedMeetings(message.scope)
    // O nome atual da Reunião vale mais que o do momento da resposta.
    for (const [label, cited] of map) {
      const current = names.get(cited.id)
      if (current) map.set(label, { ...cited, name: current })
    }
    return map
  }

  return (
    <ChatPanel
      controller={chat}
      title="Pergunte ao grupo"
      suggestions={SUGGESTIONS}
      inputLabel="Pergunta sobre as Reuniões do grupo"
      placeholder="Pergunte algo sobre as Reuniões do grupo"
      blockedReason={blockedReason}
      composerInfo={
        <span className="flex min-w-0 items-center gap-2">
          <ScopeMenu
            scope={scope}
            meetings={meetings}
            resolution={resolution}
            nowMs={nowMs}
            disabled={!editable || chat.pending !== null}
            onChange={(next) => void save(next).then(setScopeError)}
          />
          {scopeError && (
            <span role="alert" className="text-destructive truncate">
              {scopeError}
            </span>
          )}
        </span>
      }
      renderAnswer={(message) => (
        <>
          <RichText text={message.text} citations={citationsFor(message)} />
          <SourceLine message={message} />
        </>
      )}
      renderPending={(text) => (
        <RichText text={text} citations={citationsFor({ scope: chat.pendingScope })} />
      )}
    />
  )
}
