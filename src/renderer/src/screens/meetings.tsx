import { Library } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { Screen } from '@/components/layout/screen'
import { Button } from '@/components/ui/button'

export function MeetingsScreen() {
  return (
    <Screen title="Reuniões">
      <EmptyState
        icon={Library}
        title="Nenhuma Reunião ainda"
        description="As Reuniões gravadas aparecem aqui, com busca por nome, data e pelo texto da Transcrição."
        action={
          <Button asChild variant="outline">
            <a href="#/record">Ir para Gravar</a>
          </Button>
        }
      />
    </Screen>
  )
}
