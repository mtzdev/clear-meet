import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { GroupDialog } from '@/components/groups/group-dialog'
import { GroupPicker } from '@/components/groups/group-picker'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { meetingCountText, moveToGroup } from '@/lib/groups'
import type { GroupInfo, GroupsOverview } from '@shared/groups'

interface MoveToGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: readonly string[]
  overview: GroupsOverview | null
  /** Grupo comum a todas as Reuniões escolhidas (`null` = nenhuma tem grupo); ausente = misturado. */
  current?: string | null | undefined
  /** Depois de mover com sucesso. */
  onMoved?: () => void
}

/** "Mover para grupo…": escolhe o grupo (ou nenhum) de uma ou várias Reuniões. */
export function MoveToGroupDialog({
  open,
  onOpenChange,
  folders,
  overview,
  current,
  onMoved
}: MoveToGroupDialogProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const move = async (groupId: string | null): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    const failure = await moveToGroup(folders, groupId)
    setBusy(false)
    if (failure) {
      setError(failure)
      return
    }
    onOpenChange(false)
    onMoved?.()
  }

  const created = (group: GroupInfo): void => {
    void move(group.id)
  }

  return (
    <>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return
          setError(null)
          onOpenChange(next)
        }}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Mover para grupo</AlertDialogTitle>
            <AlertDialogDescription>
              {folders.length === 1
                ? 'Escolha o grupo da Reunião. Ela sai do grupo em que está.'
                : `Escolha o grupo das ${meetingCountText(folders.length)}. Elas saem dos grupos em que estão.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {overview === null ? (
            <p className="text-muted-foreground text-sm">Carregando…</p>
          ) : (
            <GroupPicker
              groups={overview.groups}
              current={current}
              disabled={busy}
              onPick={(groupId) => void move(groupId)}
              {...(overview.editable
                ? {
                    onCreate: () => {
                      onOpenChange(false)
                      setCreating(true)
                    }
                  }
                : {})}
            />
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            {busy && <LoaderCircle className="text-muted-foreground animate-spin" aria-hidden />}
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <GroupDialog open={creating} onOpenChange={setCreating} onSaved={created} />
    </>
  )
}
