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

interface DeleteVideoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  folder: string
  name: string
  /** Antes de apagar: a tela solta o arquivo que o player mantém aberto. */
  prepare?: () => Promise<void>
  /** Depois da tentativa (`deleted` = o Vídeo foi para a Lixeira). */
  onFinished?: (deleted: boolean) => void
}

/** Confirmação para mandar só o Vídeo da Reunião para a Lixeira. */
export function DeleteVideoDialog({
  open,
  onOpenChange,
  folder,
  name,
  prepare,
  onFinished
}: DeleteVideoDialogProps) {
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
    let deleted = false
    try {
      await prepare?.()
      const result = await window.api.invoke('meeting:deleteVideo', { folder })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      deleted = true
      onOpenChange(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setDeleting(false)
      onFinished?.(deleted)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={change}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Apagar só o vídeo?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                O vídeo de{' '}
                <strong className="text-foreground font-medium break-words">{name}</strong> irá para
                a Lixeira.
              </p>
              <p>
                O áudio, a Transcrição, o Resumo e as Anotações continuam, e a Reunião segue
                disponível só com o áudio.
              </p>
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
