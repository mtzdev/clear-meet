import { useState, type ReactNode } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type TabId = 'summary' | 'transcript' | 'notes' | 'ask'

interface SidePanelProps {
  noteCount: number
  summary: ReactNode
  notes: ReactNode
  transcript: ReactNode
  ask: ReactNode
  /** Abre direto no Resumo quando ele existe ou está sendo gerado. */
  hasSummary: boolean
  /** Abre direto na Transcrição quando ela existe ou está sendo gerada. */
  hasTranscript: boolean
}

export function SidePanel({
  noteCount,
  summary,
  notes,
  transcript,
  ask,
  hasSummary,
  hasTranscript
}: SidePanelProps) {
  const [tab, setTab] = useState<TabId>(
    hasSummary ? 'summary' : hasTranscript ? 'transcript' : 'notes'
  )

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
        {summary}
      </TabsContent>
      <TabsContent value="transcript" className="min-h-0">
        {transcript}
      </TabsContent>
      {/* Sempre montada: o texto que está sendo digitado não se perde ao trocar de aba. */}
      <TabsContent value="notes" forceMount className="min-h-0 data-[state=inactive]:hidden">
        {notes}
      </TabsContent>
      {/* Sempre montada: o rascunho da pergunta e a rolagem da Conversa não se perdem ao trocar de aba. */}
      <TabsContent value="ask" forceMount className="min-h-0 data-[state=inactive]:hidden">
        {ask}
      </TabsContent>
    </Tabs>
  )
}
