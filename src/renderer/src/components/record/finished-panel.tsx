import { NO_AUDIO_NOTICE } from '@shared/audio-inputs'
import { CircleCheck, FolderOpen, NotebookText, ScrollText, TriangleAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { WarningNotice } from '@/components/record/notices'
import { MeetingTags } from '@/components/tags/meeting-tags'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAiStatus } from '@/lib/ai'
import { formatDuration } from '@/lib/format'
import { STOP_REASON_TEXT } from '@/lib/record-text'
import { navigate, openMeeting } from '@/lib/router'
import type { FinishedRecording } from '@shared/recording'

/** Depois de parar: nome sugerido (editável), pasta da Reunião e como seguir. */
export function FinishedPanel({ finished }: { finished: FinishedRecording }) {
  const [name, setName] = useState(finished.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const ai = useAiStatus()
  const hasKey = ai.status?.keys.gemini.configured ?? false

  /**
   * Salva o nome se mudou. Devolve a pasta atual da Reunião, ou `null` se algo impede de
   * seguir (a mensagem já foi mostrada).
   */
  const saveName = async (): Promise<string | null> => {
    const trimmed = name.trim()
    if (trimmed === '' || trimmed === finished.name) return finished.folder
    const renamed = await window.api.invoke('meeting:rename', {
      folder: finished.folder,
      name: trimmed
    })
    if (!renamed.ok) {
      setError(renamed.error.message)
      return null
    }
    if (!renamed.value.folderRenamed) {
      // O nome ficou salvo, mas a pasta está em uso e manteve o nome antigo.
      setNote(
        'O nome foi salvo, mas a pasta ainda tem o nome antigo porque algum programa a está usando. Clique em Concluir ou em Abrir Reunião para seguir.'
      )
      return null
    }
    return renamed.value.folder
  }

  /** Salva o nome (se mudou) e libera o painel; com `open`, segue para a tela da Reunião. */
  const done = async (event?: FormEvent, open = false) => {
    event?.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if ((await saveName()) === null) return
      await window.api.invoke('recording:acknowledge')
      if (open) openMeeting(finished.meetingId)
    } finally {
      setSaving(false)
    }
  }

  /** Inicia a Transcrição em segundo plano e abre a Reunião; sem chave, leva às Configurações. */
  const transcribe = async (requestSummary: boolean) => {
    setSaving(true)
    setError(null)
    try {
      const folder = await saveName()
      if (folder === null) return
      if (!hasKey) {
        navigate('settings')
        return
      }
      const started = await window.api.invoke('transcript:start', { folder, requestSummary })
      if (!started.ok) {
        setError(started.error.message)
        return
      }
      await window.api.invoke('recording:acknowledge')
      openMeeting(finished.meetingId)
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

      {finished.status === 'ready' && (
        <div className="space-y-2">
          <Label>Tags</Label>
          <MeetingTags folder={finished.folder} tags={[]} blockedReason={null} />
        </div>
      )}

      {finished.status === 'ready' && !finished.hasAudioInput && (
        <p className="text-muted-foreground text-sm">{NO_AUDIO_NOTICE}</p>
      )}

      {finished.status === 'ready' && finished.hasAudioInput && (
        <div className="border-border bg-card space-y-3 rounded-xl border p-4">
          <div className="flex items-start gap-3">
            <ScrollText className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="space-y-0.5">
              <h3 className="text-sm font-semibold tracking-tight">Transcrição com IA</h3>
              <p className="text-muted-foreground text-xs">
                {ai.status && !hasKey
                  ? 'Configure a chave do Gemini nas Configurações para transcrever.'
                  : 'Gera as falas de cada Falante. O áudio é enviado ao Gemini com a sua chave.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={saving || name.trim() === '' || !ai.status}
              onClick={() => void transcribe(false)}
            >
              Só transcrever
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving || name.trim() === '' || !ai.status}
              onClick={() => void transcribe(true)}
            >
              Transcrever + resumir
            </Button>
          </div>
        </div>
      )}

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
        <div className="flex items-center gap-2">
          <Button type="submit" variant="outline" disabled={saving || name.trim() === ''}>
            Concluir
          </Button>
          <Button
            type="button"
            disabled={saving || name.trim() === ''}
            onClick={() => void done(undefined, true)}
          >
            <NotebookText aria-hidden />
            Abrir Reunião
          </Button>
        </div>
      </div>
    </form>
  )
}
