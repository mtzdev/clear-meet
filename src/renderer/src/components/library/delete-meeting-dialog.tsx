import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { navigate, parseMeetingId } from '@/lib/router'

interface DeleteMeetingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  id: string
  folder: string
  name: string
}

/** Confirmação para enviar a Reunião inteira (a pasta) para a Lixeira. */
export function DeleteMeetingDialog({
  open,
  onOpenChange,
  id,
  folder,
  name
}: DeleteMeetingDialogProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const change = (next: boolean): void => {
    if (deleting) return
    if (next) setError(null)
    onOpenChange(next)
  }

  const confirm = async (): Promise<void> => {
    setDeleting(true)
    setError(null)
    try {
      const result = await window.api.invoke('meeting:delete', { folder })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      onOpenChange(false)
      // A Reunião aberta deixou de existir: volta para a lista.
      if (parseMeetingId(window.location.hash) === id) navigate('meetings')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={change}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir a Reunião?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                <strong className="text-foreground font-medium break-words">{name}</strong> irá para
                a Lixeira, com o vídeo, o áudio, a Transcrição, o Resumo, a Conversa e as Anotações.
              </p>
              <p>Dá para restaurá-la pela Lixeira do Windows.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
          <Button variant="destructive" disabled={deleting} onClick={() => void confirm()}>
            {deleting && <LoaderCircle className="animate-spin" aria-hidden />}
            Enviar para a Lixeira
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
