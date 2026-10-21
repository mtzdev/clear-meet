import { FileText, FolderInput, Pencil, RefreshCw, Sparkles, Trash2, VideoOff } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DeleteMeetingDialog } from '@/components/library/delete-meeting-dialog'
import { DeleteVideoDialog } from '@/components/library/delete-video-dialog'
import { NotesPreview } from '@/components/library/notes-preview'
import { Snippet } from '@/components/library/snippet'
import { StatusBadge } from '@/components/library/status-badge'
import { Thumbnail } from '@/components/library/thumbnail'
import { TitleEditor } from '@/components/library/title-editor'
import { MeetingGroup } from '@/components/groups/meeting-group'
import { SourceIcon } from '@/components/meeting/source-icon'
import { MeetingTags } from '@/components/tags/meeting-tags'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCompactionPercent } from '@/lib/compaction'
import { formatBytes, formatDateTime, formatDuration } from '@/lib/format'
import { SOURCE_KIND_LABEL } from '@/lib/meeting-text'
import { meetingHref } from '@/lib/router'
import { cn } from '@/lib/utils'
import type { GroupsOverview } from '@shared/groups'
import {
  listBlock,
  LIST_BLOCK_TEXT,
  type HitKind,
  type LibraryEntry,
  type MeetingListItem,
  type SearchHit
} from '@shared/library'
import { formatInstant } from '@shared/timeline'

const HIT_LABEL: Record<HitKind, string> = {
  name: 'Nome',
  utterance: 'Transcrição',
  note: 'Anotação',
  summary: 'Resumo',
  tag: 'Tag'
}

const FOLDER_NOTICE_MS = 8000

function HitLink({ id, hit }: { id: string; hit: SearchHit }) {
  return (
    <a
      href={meetingHref(id, hit.offsetMs)}
      className="hover:bg-accent focus-visible:ring-ring/60 flex items-baseline gap-2 rounded-md px-2 py-1 text-xs outline-none focus-visible:ring-2"
    >
      <span className="text-muted-foreground w-28 shrink-0">
        {HIT_LABEL[hit.kind]}
        {hit.offsetMs !== null && (
          <span className="text-primary ml-1.5 font-medium tabular-nums">
            {formatInstant(hit.offsetMs)}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 leading-relaxed">
        {hit.speaker && (
          <span className="text-muted-foreground mr-1">
            <Snippet parts={hit.speaker} />:
          </span>
        )}
        <Snippet parts={hit.parts} />
      </span>
    </a>
  )
}

/** Botão de ícone que, bloqueado, continua focável e explica o motivo no tooltip. */
function ActionButton({
  label,
  blocked,
  onClick,
  className,
  children
}: {
  label: string
  /** Motivo do bloqueio, ou `null` se a ação está liberada. */
  blocked: string | null
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          aria-disabled={blocked !== null}
          className={cn(
            'relative z-10 shrink-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent',
            className
          )}
          onClick={() => {
            if (blocked === null) onClick()
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{blocked ?? label}</TooltipContent>
    </Tooltip>
  )
}

interface MeetingCardProps {
  entry: LibraryEntry
  groups: GroupsOverview | null
  selected: boolean
  /** Há Reuniões escolhidas na lista: o quadradinho fica sempre visível. */
  selecting: boolean
  onSelectedChange: (selected: boolean) => void
  onMoveRequest: (meeting: MeetingListItem) => void
}

/**
 * Uma Reunião na lista: o cartão todo abre a Reunião; cada trecho achado abre já no Instante.
 * Editar o título, excluir e a prévia das Anotações ficam sobre o cartão (o menu de contexto
 * também oferece as duas ações). O quadradinho de escolha e o grupo servem à seleção em lote.
 */
export function MeetingCard({
  entry,
  groups,
  selected,
  selecting,
  onSelectedChange,
  onMoveRequest
}: MeetingCardProps) {
  const { meeting, hits, hitCount } = entry
  const source =
    meeting.source.kind === 'window' && meeting.source.name
      ? meeting.source.name
      : SOURCE_KIND_LABEL[meeting.source.kind]
  const details = [
    formatDateTime(meeting.createdAt),
    meeting.durationMs !== null ? formatDuration(meeting.durationMs) : null,
    formatBytes(meeting.sizeBytes)
  ].filter((part): part is string => Boolean(part))

  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmingVideoDelete, setConfirmingVideoDelete] = useState(false)
  const compactionPercent = useCompactionPercent(meeting.id)
  /** Nome recém-salvo, mostrado até o índice trazer o novo nome. */
  const [saved, setSaved] = useState<{ from: string; to: string } | null>(null)
  const [folderNotice, setFolderNotice] = useState(false)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  const renameBlock = listBlock(meeting, 'rename')
  const deleteBlock = listBlock(meeting, 'delete')
  const renameReason = renameBlock && LIST_BLOCK_TEXT[renameBlock]
  const deleteReason = deleteBlock && LIST_BLOCK_TEXT[deleteBlock]
  const tagBlock = listBlock(meeting, 'tag')
  const groupBlock = listBlock(meeting, 'group')
  const groupReason = groupBlock && LIST_BLOCK_TEXT[groupBlock]
  const videoBlock = listBlock(meeting, 'delete-video')
  const videoReason = videoBlock && LIST_BLOCK_TEXT[videoBlock]
  const name = saved?.from === meeting.name ? saved.to : meeting.name

  const startEditing = (): void => {
    if (renameBlock === null) setEditing(true)
  }
  const askDelete = (): void => {
    if (deleteBlock === null) setConfirmingDelete(true)
  }
  const askDeleteVideo = (): void => {
    if (videoBlock === null) setConfirmingVideoDelete(true)
  }
  const retryCompaction = (): void => {
    void window.api.invoke('compaction:retry', { folder: meeting.folder })
  }

  const save = async (next: string): Promise<string | null> => {
    try {
      const result = await window.api.invoke('meeting:rename', {
        folder: meeting.folder,
        name: next
      })
      if (!result.ok) return result.error.message
      setSaved({ from: meeting.name, to: result.value.name })
      if (!result.value.folderRenamed) {
        setFolderNotice(true)
        clearTimeout(noticeTimer.current)
        noticeTimer.current = setTimeout(() => setFolderNotice(false), FOLDER_NOTICE_MS)
      }
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <li
            className={cn(
              'group/card border-border hover:bg-accent/40 focus-within:ring-ring/60 relative rounded-xl border transition-colors focus-within:ring-2',
              selected && 'border-primary/60 bg-accent/50'
            )}
          >
            <input
              type="checkbox"
              checked={selected}
              disabled={groupBlock !== null}
              title={groupReason ?? undefined}
              aria-label={`Escolher ${name}`}
              className={cn(
                'accent-primary absolute top-4.5 left-4.5 z-20 size-4 cursor-pointer disabled:cursor-not-allowed',
                selecting || selected
                  ? 'opacity-100'
                  : 'opacity-0 group-focus-within/card:opacity-100 group-hover/card:opacity-100 focus-visible:opacity-100'
              )}
              onChange={(event) => onSelectedChange(event.target.checked)}
            />
            <div className="relative flex gap-4 p-3 pr-14">
              <Thumbnail item={meeting} className="w-36" />
              <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5">
                <div className="flex items-start gap-2">
                  {editing ? (
                    <TitleEditor name={name} onSave={save} onClose={() => setEditing(false)} />
                  ) : (
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                      <a
                        href={meetingHref(meeting.id)}
                        className="min-w-0 truncate text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
                      >
                        {name}
                      </a>
                      <MeetingTags
                        folder={meeting.folder}
                        tags={meeting.tags}
                        blockedReason={tagBlock && LIST_BLOCK_TEXT[tagBlock]}
                        className="relative z-10"
                        addClassName="opacity-0 group-focus-within/card:opacity-100 group-hover/card:opacity-100 focus-visible:opacity-100"
                      />
                      <ActionButton
                        label="Editar título"
                        blocked={renameReason}
                        onClick={startEditing}
                        className="opacity-0 group-focus-within/card:opacity-100 group-hover/card:opacity-100 focus-visible:opacity-100 aria-disabled:group-focus-within/card:opacity-50 aria-disabled:group-hover/card:opacity-50"
                      >
                        <Pencil aria-hidden />
                      </ActionButton>
                    </div>
                  )}
                  <StatusBadge item={meeting} percent={compactionPercent} />
                </div>
                <p className="text-muted-foreground truncate text-xs">{details.join(' · ')}</p>
                {folderNotice && (
                  <p role="status" className="text-warning relative z-10 text-xs">
                    Nome salvo. A pasta mantém o nome antigo porque está em uso.
                  </p>
                )}
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <MeetingGroup
                    folder={meeting.folder}
                    groupId={meeting.groupId}
                    overview={groups}
                    blockedReason={groupReason}
                    className="relative z-10"
                    addClassName="opacity-0 group-focus-within/card:opacity-100 group-hover/card:opacity-100 focus-visible:opacity-100"
                  />
                  <span className="flex min-w-0 items-center gap-1.5">
                    <SourceIcon kind={meeting.source.kind} className="size-3.5" />
                    <span className="truncate">{source}</span>
                  </span>
                  <NotesPreview meetingId={meeting.id} count={meeting.noteCount} />
                  {meeting.transcriptStatus === 'ready' && (
                    <span className="flex items-center gap-1">
                      <FileText className="size-3.5" aria-hidden />
                      Transcrição
                    </span>
                  )}
                  {meeting.summaryStatus === 'ready' && (
                    <span className="flex items-center gap-1">
                      <Sparkles className="size-3.5" aria-hidden />
                      Resumo
                    </span>
                  )}
                </div>
              </div>
              <ActionButton
                label="Excluir Reunião"
                blocked={deleteReason}
                onClick={askDelete}
                className="hover:text-destructive absolute top-1/2 right-3 -translate-y-1/2"
              >
                <Trash2 aria-hidden />
              </ActionButton>
            </div>
            {hits.length > 0 && (
              <ul className="border-border relative z-10 space-y-0.5 border-t px-2 py-2">
                {hits.map((hit, index) => (
                  <li key={index}>
                    <HitLink id={meeting.id} hit={hit} />
                  </li>
                ))}
                {hitCount > hits.length && (
                  <li className="text-muted-foreground px-2 pt-1 text-xs">
                    +{hitCount - hits.length} {hitCount - hits.length === 1 ? 'trecho' : 'trechos'}{' '}
                    nesta Reunião
                  </li>
                )}
              </ul>
            )}
          </li>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
          <ContextMenuItem disabled={renameBlock !== null} onSelect={startEditing}>
            <Pencil aria-hidden />
            Editar título
            {renameReason && <ContextMenuShortcut>{renameReason}</ContextMenuShortcut>}
          </ContextMenuItem>
          <ContextMenuItem disabled={groupBlock !== null} onSelect={() => onMoveRequest(meeting)}>
            <FolderInput aria-hidden />
            Mover para grupo…
            {groupReason && <ContextMenuShortcut>{groupReason}</ContextMenuShortcut>}
          </ContextMenuItem>
          {meeting.hasVideo && (
            <ContextMenuItem
              variant="destructive"
              disabled={videoBlock !== null}
              onSelect={askDeleteVideo}
            >
              <VideoOff aria-hidden />
              Apagar só o vídeo
              {videoReason && <ContextMenuShortcut>{videoReason}</ContextMenuShortcut>}
            </ContextMenuItem>
          )}
          {meeting.compactionStatus === 'error' && (
            <ContextMenuItem onSelect={retryCompaction}>
              <RefreshCw aria-hidden />
              Tentar compactar de novo
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            disabled={deleteBlock !== null}
            onSelect={askDelete}
          >
            <Trash2 aria-hidden />
            Excluir
            {deleteReason && <ContextMenuShortcut>{deleteReason}</ContextMenuShortcut>}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <DeleteVideoDialog
        open={confirmingVideoDelete}
        onOpenChange={setConfirmingVideoDelete}
        folder={meeting.folder}
        name={name}
      />
      <DeleteMeetingDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        id={meeting.id}
        folder={meeting.folder}
        name={name}
      />
    </>
  )
}
