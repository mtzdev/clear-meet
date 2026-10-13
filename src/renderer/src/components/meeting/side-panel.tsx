import { MessageCircleQuestion, Sparkles, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type TabId = 'summary' | 'transcript' | 'notes' | 'ask'

function Placeholder({
  icon: Icon,
  title,
  description
}: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-12 text-center">
      <div className="bg-accent text-accent-foreground grid size-12 place-items-center rounded-2xl">
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="max-w-xs space-y-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed text-balance">{description}</p>
      </div>
    </div>
  )
}

interface SidePanelProps {
  noteCount: number
  notes: ReactNode
  transcript: ReactNode
  /** Abre direto na Transcrição quando ela existe ou está sendo gerada. */
  hasTranscript: boolean
}

export function SidePanel({ noteCount, notes, transcript, hasTranscript }: SidePanelProps) {
  const [tab, setTab] = useState<TabId>(hasTranscript ? 'transcript' : 'notes')

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as TabId)}
      className="h-full min-h-0 gap-0"
    >
      <div className="border-border shrink-0 border-b p-3">
        <TabsList className="flex w-full">
          <TabsTrigger value="summary">Resumo</TabsTrigger>
          <TabsTrigger value="transcript">Transcrição</TabsTrigger>
          <TabsTrigger value="notes" className="flex-[1.4]">
            Anotações
            {noteCount > 0 && (
              <span className="text-muted-foreground text-xs tabular-nums">{noteCount}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="ask">Perguntar</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="summary" className="min-h-0">
        <Placeholder
          icon={Sparkles}
          title="O Resumo ainda não foi gerado"
          description="Quando a Transcrição estiver pronta, os pontos principais, as decisões e quem faz o quê aparecem aqui."
        />
      </TabsContent>
      <TabsContent value="transcript" className="min-h-0">
        {transcript}
      </TabsContent>
      {/* Sempre montada: o texto que está sendo digitado não se perde ao trocar de aba. */}
      <TabsContent value="notes" forceMount className="min-h-0 data-[state=inactive]:hidden">
        {notes}
      </TabsContent>
      <TabsContent value="ask" className="min-h-0">
        <Placeholder
          icon={MessageCircleQuestion}
          title="Ainda não dá para perguntar"
          description="As perguntas são respondidas a partir da Transcrição. Depois de gerá-la, você poderá perguntar sobre esta Reunião e abrir o trecho do vídeo citado."
        />
      </TabsContent>
    </Tabs>
  )
}
