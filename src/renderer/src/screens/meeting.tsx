import { NotebookText } from 'lucide-react'
import { EmptyState } from '@/components/empty-state'
import { Screen } from '@/components/layout/screen'
import { Button } from '@/components/ui/button'

/** Detalhe de uma Reunião (player, Resumo, Transcrição, Anotações e Perguntas — Fase 4 em diante). */
export function MeetingScreen() {
  return (
    <Screen title="Reunião">
      <EmptyState
        icon={NotebookText}
        title="Nenhuma Reunião aberta"
        description="Escolha uma Reunião na lista para rever o vídeo, ler a Transcrição e o Resumo e consultar suas Anotações."
        action={
          <Button asChild variant="outline">
            <a href="#/meetings">Ver Reuniões</a>
          </Button>
        }
      />
    </Screen>
  )
}
