import { FolderTree, Library, SearchX, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { EmptyState } from '@/components/empty-state'
import { MoveToGroupDialog } from '@/components/groups/move-to-group-dialog'
import { GroupFilter } from '@/components/library/group-filter'
import { LibraryFilters } from '@/components/library/filters'
import { MeetingCard } from '@/components/library/meeting-card'
import { SelectionBar } from '@/components/library/selection-bar'
import { TagFilter } from '@/components/library/tag-filter'
import { Button } from '@/components/ui/button'
import { dateRange, NO_DATE_FILTER, type DateFilter } from '@/lib/date-range'
import { findGroup, moveToGroup, useGroups } from '@/lib/groups'
import { useDebounced, useLibraryQuery } from '@/lib/library'
import { useTags } from '@/lib/tags'
import { UNGROUPED_FILTER } from '@shared/groups'
import { hasTag } from '@shared/tags'
import type { LibraryQuery, LibrarySort, MeetingListItem } from '@shared/library'
import { listBlock } from '@shared/library'

const SEARCH_DEBOUNCE_MS = 250

/** Centraliza um estado vazio abaixo da barra de filtros. */
function Centered({ children }: { children: ReactNode }) {
  return <div className="min-h-[24rem]">{children}</div>
}

interface LibraryBrowserProps {
  /** Lista só as Reuniões deste grupo (tela do grupo); sem ele, todas, com o filtro de grupo. */
  groupId?: string
  /** Filtro de grupo inicial da lista geral (`UNGROUPED_FILTER` ou um id). */
  initialGroup?: string | null
}

/**
 * Lista e busca de Reuniões (nome, conversa, Anotações e Resumo), com filtros de datas, Tags e
 * grupo e seleção em lote. Serve à tela Reuniões e à tela de um grupo.
 */
export function LibraryBrowser({ groupId, initialGroup = null }: LibraryBrowserProps) {
  const [text, setText] = useState('')
  const [date, setDate] = useState<DateFilter>(NO_DATE_FILTER)
  const [sortChoice, setSortChoice] = useState<LibrarySort | null>(null)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [groupFilter, setGroupFilter] = useState<string | null>(initialGroup)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [moving, setMoving] = useState<{
    folders: string[]
    current: string | null | undefined
  } | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const { tags } = useTags()
  const groups = useGroups()
  const overview = groups.overview

  // Pastas mexidas fora do app aparecem ao abrir a tela.
  useEffect(() => {
    void window.api.invoke('library:refresh')
  }, [])

  const debouncedText = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS)
  const searching = text.trim() !== ''
  const sort: LibrarySort =
    sortChoice === 'relevance' && !searching
      ? 'newest'
      : (sortChoice ?? (searching ? 'relevance' : 'newest'))

  const range = useMemo(
    () => dateRange(date, new Date()),
    // O intervalo é calculado quando o filtro muda, não a cada renderização.
    [date]
  )
  // Uma Tag apagada ou renomeada deixa de valer no filtro.
  const activeTags = useMemo(
    () =>
      tags === null
        ? selectedTags
        : selectedTags.filter((name) =>
            hasTag(
              tags.map((t) => t.name),
              name
            )
          ),
    [tags, selectedTags]
  )
  // Um grupo apagado deixa de valer no filtro.
  const staleGroup =
    groupFilter !== null &&
    groupFilter !== UNGROUPED_FILTER &&
    overview !== null &&
    findGroup(overview, groupFilter) === null
  const activeGroup = groupId ?? (staleGroup ? null : groupFilter)
  const query: LibraryQuery = {
    text: debouncedText,
    tags: activeTags,
    groupId: activeGroup,
    fromMs: range.fromMs,
    toMs: range.toMs,
    sort,
    limit: null
  }
  const library = useLibraryQuery(query)
  const { data } = library

  const filtered =
    searching ||
    date.preset !== 'all' ||
    activeTags.length > 0 ||
    (groupId === undefined && activeGroup !== null)
  const clearFilters = (): void => {
    setText('')
    setDate(NO_DATE_FILTER)
    setSelectedTags([])
    setSortChoice(null)
    if (groupId === undefined) setGroupFilter(null)
  }

  // Reuniões que saíram da lista (filtro, exclusão, mudança de grupo) deixam de estar escolhidas.
  const visibleIds = useMemo(
    () => new Set(data?.entries.map((entry) => entry.meeting.id) ?? []),
    [data]
  )
  const [prunedFor, setPrunedFor] = useState(visibleIds)
  if (prunedFor !== visibleIds) {
    setPrunedFor(visibleIds)
    setSelected((current) => {
      const kept = [...current].filter((id) => visibleIds.has(id))
      return kept.length === current.size ? current : new Set(kept)
    })
  }

  const entries = data?.entries ?? []
  const chosen: MeetingListItem[] = entries
    .map((entry) => entry.meeting)
    .filter((meeting) => selected.has(meeting.id))
  const selectable = entries.filter((entry) => listBlock(entry.meeting, 'group') === null)

  const toggle = (id: string, on: boolean): void => {
    setBulkError(null)
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const commonGroup = (items: readonly MeetingListItem[]): string | null | undefined => {
    const first = items[0]?.groupId ?? null
    return items.every((item) => (item.groupId ?? null) === first) ? first : undefined
  }

  const requestMove = (meeting: MeetingListItem): void => {
    const items = selected.has(meeting.id) && chosen.length > 0 ? chosen : [meeting]
    setMoving({ folders: items.map((item) => item.folder), current: commonGroup(items) })
  }

  const removeFromGroups = async (): Promise<void> => {
    setBulkBusy(true)
    setBulkError(null)
    const failure = await moveToGroup(
      chosen.map((meeting) => meeting.folder),
      null
    )
    setBulkBusy(false)
    if (failure) setBulkError(failure)
    else setSelected(new Set())
  }

  const groupInfo = groupId === undefined ? null : findGroup(overview, groupId)

  return (
    <>
      <div className="bg-background/95 border-border sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto max-w-4xl px-8 py-4">
          <LibraryFilters
            text={text}
            onText={setText}
            date={date}
            onDate={setDate}
            sort={sort}
            onSort={setSortChoice}
            searching={searching}
          />
          {((tags !== null && tags.length > 0) ||
            (groupId === undefined && overview !== null && overview.groups.length > 0)) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              {groupId === undefined && overview !== null && overview.groups.length > 0 && (
                <GroupFilter
                  groups={overview.groups}
                  value={activeGroup}
                  onChange={setGroupFilter}
                />
              )}
              {tags !== null && tags.length > 0 && (
                <TagFilter tags={tags} selected={activeTags} onChange={setSelectedTags} />
              )}
            </div>
          )}
        </div>
      </div>

      {data === null && library.error !== null && (
        <Centered>
          <EmptyState
            icon={TriangleAlert}
            title="Não foi possível listar as Reuniões"
            description={library.error}
            action={
              <Button variant="outline" onClick={library.reload}>
                Tentar de novo
              </Button>
            }
          />
        </Centered>
      )}
      {data === null && library.error === null && (
        <p className="text-muted-foreground px-8 py-6 text-sm">Carregando as Reuniões…</p>
      )}

      {data !== null && data.indexed === 0 && data.updating && (
        <p className="text-muted-foreground px-8 py-6 text-sm">Carregando as Reuniões…</p>
      )}
      {data !== null && data.indexed === 0 && !data.updating && (
        <Centered>
          <EmptyState
            icon={Library}
            title="Nenhuma Reunião ainda"
            description="As Reuniões gravadas aparecem aqui, da mais recente para a mais antiga."
            action={
              <Button asChild variant="outline">
                <a href="#/record">Ir para Gravar</a>
              </Button>
            }
          />
        </Centered>
      )}
      {data !== null && data.indexed > 0 && data.entries.length === 0 && !filtered && groupId && (
        <Centered>
          <EmptyState
            icon={FolderTree}
            title="Este grupo não tem Reuniões"
            description={
              groupInfo?.rules
                ? 'As Reuniões novas que combinarem com as regras entram aqui. Você também pode movê-las pela lista de Reuniões.'
                : 'Na lista de Reuniões, escolha as Reuniões e use “Mover para grupo”.'
            }
            action={
              <Button asChild variant="outline">
                <a href="#/meetings">Ver todas as Reuniões</a>
              </Button>
            }
          />
        </Centered>
      )}
      {data !== null && data.indexed > 0 && data.entries.length === 0 && (filtered || !groupId) && (
        <Centered>
          <EmptyState
            icon={SearchX}
            title="Nenhuma Reunião encontrada"
            description="Tente outras palavras, outras Tags, outro grupo ou mude o período."
            action={
              filtered ? (
                <Button variant="outline" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              ) : undefined
            }
          />
        </Centered>
      )}
      {data !== null && data.entries.length > 0 && (
        <div className="mx-auto max-w-4xl space-y-4 px-8 py-5">
          {filtered && (
            <p className="text-muted-foreground text-xs" role="status">
              {data.total} {data.total === 1 ? 'Reunião encontrada' : 'Reuniões encontradas'}
            </p>
          )}
          <ul className="space-y-2.5">
            {data.entries.map((entry) => (
              <MeetingCard
                key={entry.meeting.id}
                entry={entry}
                groups={overview}
                selected={selected.has(entry.meeting.id)}
                selecting={selected.size > 0}
                onSelectedChange={(on) => toggle(entry.meeting.id, on)}
                onMoveRequest={requestMove}
              />
            ))}
          </ul>
          {data.total > data.entries.length && (
            <p className="text-muted-foreground text-xs">
              Mostrando {data.entries.length} de {data.total} Reuniões. Refine a busca para ver as
              demais.
            </p>
          )}
          {data.skipped > 0 && (
            <p className="text-muted-foreground text-xs">
              {data.skipped === 1
                ? '1 pasta foi ignorada porque não pôde ser lida.'
                : `${data.skipped} pastas foram ignoradas porque não puderam ser lidas.`}{' '}
              Nada foi alterado nelas.
            </p>
          )}
        </div>
      )}

      {chosen.length > 0 && (
        <SelectionBar
          count={chosen.length}
          anyGrouped={chosen.some((meeting) => meeting.groupId !== null)}
          allSelected={selectable.every((entry) => selected.has(entry.meeting.id))}
          busy={bulkBusy}
          error={bulkError}
          disabled={overview !== null && !overview.editable}
          onMove={() =>
            setMoving({
              folders: chosen.map((meeting) => meeting.folder),
              current: commonGroup(chosen)
            })
          }
          onRemove={() => void removeFromGroups()}
          onSelectAll={() => setSelected(new Set(selectable.map((entry) => entry.meeting.id)))}
          onClear={() => {
            setSelected(new Set())
            setBulkError(null)
          }}
        />
      )}

      <MoveToGroupDialog
        open={moving !== null}
        onOpenChange={(open) => {
          if (!open) setMoving(null)
        }}
        folders={moving?.folders ?? []}
        overview={overview}
        current={moving?.current}
        onMoved={() => setSelected(new Set())}
      />
    </>
  )
}
