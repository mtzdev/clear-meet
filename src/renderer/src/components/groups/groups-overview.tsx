import {
  ChevronDown,
  ChevronUp,
  FolderPlus,
  FolderTree,
  Lightbulb,
  Plus,
  TriangleAlert,
  X,
  Zap
} from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/empty-state'
import { GroupDialog } from '@/components/groups/group-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateTime, formatDuration } from '@/lib/format'
import { meetingCountText, type GroupsState } from '@/lib/groups'
import { groupHref, meetingsGroupHref } from '@/lib/router'
import { settle } from '@/lib/tags'
import { cn } from '@/lib/utils'
import {
  describeRules,
  UNGROUPED_FILTER,
  type GroupInfo,
  type GroupsOverview,
  type GroupSuggestion
} from '@shared/groups'

function RuleChips({ rules }: { rules: NonNullable<GroupInfo['rules']> }) {
  return (
    <ul className="flex flex-wrap gap-1">
      {describeRules(rules).map((line) => (
        <li
          key={line}
          className="bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 text-[11px]"
        >
          {line}
        </li>
      ))}
    </ul>
  )
}

interface GroupCardProps {
  group: GroupInfo
  position: number
  total: number
  editable: boolean
  onMove: (group: GroupInfo, direction: -1 | 1) => void
}

function GroupCard({ group, position, total, editable, onMove }: GroupCardProps) {
  const stats = [
    meetingCountText(group.count),
    group.count > 0 ? formatDuration(group.totalDurationMs) : null,
    group.lastMeetingAt ? `última em ${formatDateTime(group.lastMeetingAt).split(' ')[0]}` : null
  ].filter((part): part is string => Boolean(part))
  const auto = group.rules !== null
  const reorderClass =
    'relative z-10 opacity-0 group-focus-within/group:opacity-100 group-hover/group:opacity-100 focus-visible:opacity-100'

  return (
    <li className="group/group border-border hover:bg-accent/40 focus-within:ring-ring/60 relative flex flex-col gap-2 rounded-xl border p-4 transition-colors focus-within:ring-2">
      <div className="flex items-start gap-2">
        <FolderTree className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <a
            href={groupHref(group.id)}
            className="block truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
          >
            {group.name}
          </a>
          {group.description !== '' && (
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{group.description}</p>
          )}
        </div>
        {auto && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="bg-accent text-accent-foreground relative z-10 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px]">
                <Zap className="size-3" aria-hidden />
                Automático
              </span>
            </TooltipTrigger>
            <TooltipContent>Reuniões novas entram sozinhas pelas regras</TooltipContent>
          </Tooltip>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{stats.join(' · ')}</p>
      {group.rules && <RuleChips rules={group.rules} />}
      {editable && total > 1 && (
        <div className="absolute right-2 bottom-2 flex gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Subir ${group.name} na prioridade`}
            title="Subir na prioridade"
            disabled={position === 0}
            className={reorderClass}
            onClick={() => onMove(group, -1)}
          >
            <ChevronUp aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Descer ${group.name} na prioridade`}
            title="Descer na prioridade"
            disabled={position === total - 1}
            className={reorderClass}
            onClick={() => onMove(group, 1)}
          >
            <ChevronDown aria-hidden />
          </Button>
        </div>
      )}
    </li>
  )
}

function SuggestionRow({
  suggestion,
  busy,
  onAccept,
  onDismiss
}: {
  suggestion: GroupSuggestion
  busy: boolean
  onAccept: (suggestion: GroupSuggestion) => void
  onDismiss: (suggestion: GroupSuggestion) => void
}) {
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium">
          {suggestion.name}
          <span className="text-muted-foreground font-normal">
            {' '}
            · {meetingCountText(suggestion.count)}
          </span>
        </p>
        <RuleChips rules={suggestion.rules} />
      </div>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onAccept(suggestion)}>
        <Plus aria-hidden />
        Criar grupo
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={busy}
        aria-label={`Dispensar a sugestão ${suggestion.name}`}
        title="Dispensar"
        onClick={() => onDismiss(suggestion)}
      >
        <X aria-hidden />
      </Button>
    </li>
  )
}

/** Aba "Grupos" da tela Reuniões: sugestões, cartões dos grupos e o botão de criar. */
export function GroupsPanel({ state }: { state: GroupsState }) {
  const { overview } = state
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (overview === null) {
    return <p className="text-muted-foreground px-8 py-6 text-sm">Carregando os grupos…</p>
  }

  const run = async (action: () => Promise<{ ok: boolean; message?: string }>): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await action()
    setBusy(false)
    if (!result.ok) setError(result.message ?? 'Não foi possível concluir.')
  }

  const accept = (suggestion: GroupSuggestion): Promise<void> =>
    run(async () => {
      const result = await settle(
        window.api.invoke('groups:acceptSuggestion', { id: suggestion.id })
      )
      return result.ok ? { ok: true } : { ok: false, message: result.error.message }
    })

  const dismiss = (suggestion: GroupSuggestion): Promise<void> =>
    run(async () => {
      const result = await settle(
        window.api.invoke('groups:dismissSuggestion', { id: suggestion.id })
      )
      return result.ok ? { ok: true } : { ok: false, message: result.error.message }
    })

  const move = (group: GroupInfo, direction: -1 | 1): Promise<void> =>
    run(async () => {
      const ids = overview.groups.map((item) => item.id)
      const from = ids.indexOf(group.id)
      const to = from + direction
      if (from === -1 || to < 0 || to >= ids.length) return { ok: true }
      ;[ids[from], ids[to]] = [ids[to] as string, ids[from] as string]
      const result = await settle(window.api.invoke('groups:reorder', { ids }))
      return result.ok ? { ok: true } : { ok: false, message: result.error.message }
    })

  const hasAuto = overview.groups.some((group) => group.rules !== null)

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-8 py-5">
      {!overview.editable && <Unavailable overview={overview} onRetry={state.recheck} />}

      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {overview.groups.length === 0
            ? 'Agrupe Reuniões de uma mesma série ou assunto.'
            : `${overview.groups.length} ${overview.groups.length === 1 ? 'grupo' : 'grupos'} · ${meetingCountText(overview.ungroupedCount)} sem grupo`}
        </p>
        <div className="flex items-center gap-2">
          {overview.ungroupedCount > 0 && overview.groups.length > 0 && (
            <Button asChild variant="ghost" size="sm">
              <a href={meetingsGroupHref(UNGROUPED_FILTER)}>Ver sem grupo</a>
            </Button>
          )}
          <Button size="sm" disabled={!overview.editable} onClick={() => setCreating(true)}>
            <FolderPlus aria-hidden />
            Novo grupo
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {overview.suggestions.length > 0 && (
        <section
          aria-label="Sugestões de grupo"
          className="border-border bg-card rounded-xl border px-4 py-3"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Lightbulb className="text-muted-foreground size-4" aria-hidden />
            Sugestões
          </h2>
          <p className="text-muted-foreground text-xs">
            Reuniões sem grupo que parecem de uma mesma série. Dispensadas, não voltam.
          </p>
          <ul className="divide-border mt-1 divide-y">
            {overview.suggestions.map((suggestion) => (
              <SuggestionRow
                key={suggestion.id}
                suggestion={suggestion}
                busy={busy}
                onAccept={(item) => void accept(item)}
                onDismiss={(item) => void dismiss(item)}
              />
            ))}
          </ul>
        </section>
      )}

      {overview.groups.length === 0 ? (
        <div className="min-h-[18rem]">
          <EmptyState
            icon={FolderTree}
            title="Nenhum grupo ainda"
            description="Um grupo reúne Reuniões de uma mesma série, como uma Daily. Pode ser manual ou automático, por regras."
            action={
              <Button
                variant="outline"
                disabled={!overview.editable}
                onClick={() => setCreating(true)}
              >
                <FolderPlus aria-hidden />
                Novo grupo
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <ul className={cn('grid gap-3', 'sm:grid-cols-2')}>
            {overview.groups.map((group, index) => (
              <GroupCard
                key={group.id}
                group={group}
                position={index}
                total={overview.groups.length}
                editable={overview.editable && !busy}
                onMove={(item, direction) => void move(item, direction)}
              />
            ))}
          </ul>
          {hasAuto && overview.groups.length > 1 && (
            <p className="text-muted-foreground text-xs">
              Quando uma Reunião combina com mais de um grupo automático, vale o que está mais
              acima.
            </p>
          )}
        </>
      )}

      <GroupDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}

/** Aviso de que a pasta das Reuniões não deixa ler ou gravar os grupos. */
export function Unavailable({
  overview,
  onRetry
}: {
  overview: Pick<GroupsOverview, 'message'>
  onRetry: () => void
}) {
  return (
    <Alert>
      <TriangleAlert aria-hidden />
      <AlertTitle>Grupos indisponíveis para alteração</AlertTitle>
      <AlertDescription>
        <p>{overview.message ?? 'Não foi possível gravar os grupos na pasta das Reuniões.'}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Tentar de novo
        </Button>
      </AlertDescription>
    </Alert>
  )
}
