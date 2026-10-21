import { ChevronLeft, FolderTree, LoaderCircle, Pencil, Trash2, Zap } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/empty-state'
import { GroupDialog } from '@/components/groups/group-dialog'
import { Unavailable } from '@/components/groups/groups-overview'
import { Screen } from '@/components/layout/screen'
import { LibraryBrowser } from '@/components/library/library-browser'
import { ConfirmDialog } from '@/components/tags/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDateTime, formatDuration } from '@/lib/format'
import { findGroup, meetingCountText, useGroups } from '@/lib/groups'
import { GROUPS_VIEW_HREF, useGroupId } from '@/lib/router'
import { settle } from '@/lib/tags'
import { describeRules, type GroupInfo } from '@shared/groups'

/** Tela de um grupo: cabeçalho com os dados e as ações, e a lista das Reuniões dele. */
export function GroupScreen() {
  const id = useGroupId()
  if (!id) {
    return (
      <Screen title="Grupo">
        <EmptyState
          icon={FolderTree}
          title="Nenhum grupo aberto"
          description="Escolha um grupo na aba Grupos da tela Reuniões."
          action={
            <Button asChild variant="outline">
              <a href={GROUPS_VIEW_HREF}>Ver grupos</a>
            </Button>
          }
        />
      </Screen>
    )
  }
  return <GroupLoader key={id} id={id} />
}

function GroupLoader({ id }: { id: string }) {
  const state = useGroups()
  const { overview } = state
  const group = findGroup(overview, id)

  if (overview === null) {
    return (
      <Screen title="Grupo">
        <div className="text-muted-foreground grid h-full place-items-center">
          <LoaderCircle className="size-6 animate-spin" aria-label="Carregando o grupo" />
        </div>
      </Screen>
    )
  }
  if (!group) {
    return (
      <Screen title="Grupo">
        <EmptyState
          icon={FolderTree}
          title="Grupo não encontrado"
          description="Ele pode ter sido apagado ou a pasta das Reuniões mudou."
          action={
            <Button asChild variant="outline">
              <a href={GROUPS_VIEW_HREF}>Ver grupos</a>
            </Button>
          }
        />
      </Screen>
    )
  }
  return (
    <GroupView
      group={group}
      editable={overview.editable}
      message={overview.message}
      onRetry={state.recheck}
    />
  )
}

function GroupView({
  group,
  editable,
  message,
  onRetry
}: {
  group: GroupInfo
  editable: boolean
  message: string | null
  onRetry: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const stats = [
    meetingCountText(group.count),
    group.count > 0 ? formatDuration(group.totalDurationMs) : null,
    group.lastMeetingAt ? `última em ${formatDateTime(group.lastMeetingAt)}` : null
  ].filter((part): part is string => Boolean(part))

  const remove = async (): Promise<string | null> => {
    const result = await settle(window.api.invoke('groups:delete', { id: group.id }))
    if (!result.ok) return result.error.message
    window.location.hash = GROUPS_VIEW_HREF
    return null
  }

  return (
    <section aria-labelledby="screen-title" className="flex h-full min-h-0 flex-col">
      <header className="border-border shrink-0 border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon-sm">
            <a href={GROUPS_VIEW_HREF} aria-label="Voltar para Grupos">
              <ChevronLeft aria-hidden />
            </a>
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 id="screen-title" className="truncate text-base font-semibold tracking-tight">
                {group.name}
              </h1>
              {group.rules && (
                <span className="bg-accent text-accent-foreground inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px]">
                  <Zap className="size-3" aria-hidden />
                  Automático
                </span>
              )}
            </div>
            <p className="text-muted-foreground truncate text-xs">{stats.join(' · ')}</p>
          </div>
          <Button variant="outline" size="sm" disabled={!editable} onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            <span className="hidden min-[1000px]:inline">Editar</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!editable}
            className="hover:text-destructive"
            onClick={() => setDeleting(true)}
          >
            <Trash2 aria-hidden />
            <span className="hidden min-[1000px]:inline">Apagar</span>
          </Button>
        </div>
        {(group.description !== '' || group.rules) && (
          <div className="mt-2 space-y-1.5 pl-11">
            {group.description !== '' && (
              <p className="text-muted-foreground text-sm">{group.description}</p>
            )}
            {group.rules && (
              <ul className="flex flex-wrap gap-1">
                {describeRules(group.rules).map((line) => (
                  <li
                    key={line}
                    className="bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 text-[11px]"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </header>

      {!editable && (
        <div className="px-8 pt-3">
          <Unavailable overview={{ message }} onRetry={onRetry} />
        </div>
      )}

      <Tabs defaultValue="meetings" className="min-h-0 flex-1 gap-0">
        <div className="border-border border-b px-4 py-2">
          <TabsList aria-label="Seções do grupo">
            <TabsTrigger value="meetings">Reuniões</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="meetings" className="min-h-0 overflow-y-auto">
          <LibraryBrowser groupId={group.id} />
        </TabsContent>
      </Tabs>

      <GroupDialog open={editing} onOpenChange={setEditing} group={group} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Apagar o grupo “${group.name}”?`}
        description={
          <p>
            {group.count > 0
              ? `${meetingCountText(group.count)} ${group.count === 1 ? 'fica' : 'ficam'} sem grupo.`
              : 'Nenhuma Reunião está neste grupo.'}{' '}
            As Reuniões não são apagadas.
          </p>
        }
        confirmLabel="Apagar grupo"
        destructive
        onConfirm={remove}
      />
    </section>
  )
}
