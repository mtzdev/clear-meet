import { CircleCheck, FolderOpen, TriangleAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { WarningNotice } from '@/components/record/notices'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDuration } from '@/lib/format'
import { STOP_REASON_TEXT } from '@/lib/record-text'
import type { FinishedRecording } from '@shared/recording'

/** Depois de parar: nome sugerido (editável), pasta da Reunião e como seguir. */
export function FinishedPanel({ finished }: { finished: FinishedRecording }) {
  const [name, setName] = useState(finished.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const done = async (event?: FormEvent) => {
    event?.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const trimmed = name.trim()
      if (trimmed !== '' && trimmed !== finished.name) {
        const renamed = await window.api.invoke('meeting:rename', {
          folder: finished.folder,
          name: trimmed
        })
        if (!renamed.ok) {
          setError(renamed.error.message)
          return
        }
        if (!renamed.value.folderRenamed) {
          // O nome ficou salvo, mas a pasta está em uso e manteve o nome antigo.
          setNote(
            'O nome foi salvo, mas a pasta ainda tem o nome antigo porque algum programa a está usando. Clique em Concluir para seguir.'
          )
          return
        }
      }
      await window.api.invoke('recording:acknowledge')
    } finally {
      setSaving(false)
    }
  }

  const reasonText = STOP_REASON_TEXT[finished.reason]

  return (
    <form onSubmit={(event) => void done(event)} className="mx-auto max-w-xl space-y-6 px-8 py-12">
      <div className="space-y-3 text-center">
        <div className="bg-success/15 text-success mx-auto grid size-14 place-items-center rounded-2xl">
          <CircleCheck className="size-7" aria-hidden />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">Reunião gravada</h2>
        <p className="text-muted-foreground text-sm">
          {formatDuration(finished.durationMs)} · {finished.hasVideo ? 'Vídeo e áudio' : 'Só áudio'}
        </p>
      </div>

      {reasonText && (
        <WarningNotice title="A gravação terminou antes do esperado">{reasonText}</WarningNotice>
      )}
      {finished.status === 'unprocessed' && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>Os arquivos finais ainda não estão prontos</AlertTitle>
          <AlertDescription>
            {finished.issue ?? 'O pós-processamento não terminou.'} Nada foi perdido: o app tenta de
            novo ao abrir.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="meeting-name">Nome da Reunião</Label>
        <Input
          id="meeting-name"
          value={name}
          maxLength={120}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setName(event.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          Você pode trocar o nome depois. A pasta da Reunião acompanha o nome.
        </p>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}
      {note && <p className="text-warning text-sm">{note}</p>}

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void window.api.invoke('meeting:reveal', { folder: finished.folder })}
        >
          <FolderOpen aria-hidden />
          Abrir pasta
        </Button>
        <Button type="submit" disabled={saving || name.trim() === ''}>
          Concluir
        </Button>
      </div>
    </form>
  )
}
