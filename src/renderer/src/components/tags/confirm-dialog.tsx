import { LoaderCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
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

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  destructive?: boolean
  /** Executa a ação; devolve a mensagem de erro ou `null` se deu certo (o diálogo fecha). */
  onConfirm: () => Promise<string | null>
}

/** Confirmação de uma operação que vale para várias Reuniões (apagar ou juntar Tags). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm
}: ConfirmDialogProps) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const change = (next: boolean): void => {
    if (working) return
    if (next) setError(null)
    onOpenChange(next)
  }

  const confirm = async (): Promise<void> => {
    setWorking(true)
    setError(null)
    const failure = await onConfirm()
    setWorking(false)
    if (failure) setError(failure)
    else onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={change}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Cancelar</AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={working}
            onClick={() => void confirm()}
          >
            {working && <LoaderCircle className="animate-spin" aria-hidden />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
