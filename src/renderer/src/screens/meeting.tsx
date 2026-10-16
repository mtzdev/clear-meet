import { Info, LoaderCircle, NotebookText, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/empty-state'
import { Screen } from '@/components/layout/screen'
import { MediaPlayer, type PlayerMedia } from '@/components/meeting/media-player'
import { MeetingHeader } from '@/components/meeting/meeting-header'
import { ChatTab } from '@/components/meeting/chat-tab'
import { NotesTab } from '@/components/meeting/notes-tab'
import { SidePanel } from '@/components/meeting/side-panel'
import { SplitLayout } from '@/components/meeting/split-layout'
import { SummaryTab } from '@/components/meeting/summary-tab'
import { TranscriptTab } from '@/components/meeting/transcript-tab'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { issueText, LOCK_TEXT } from '@/lib/meeting-text'
import { useMeetingDetail } from '@/lib/meetings'
import { PlayerController } from '@/lib/player-controller'
import { useRecordingState } from '@/lib/recording'
import { useMeetingId } from '@/lib/router'
import { useSummaryView } from '@/lib/summary'
import { useTranscriptView } from '@/lib/transcript'
import { usePlayerShortcuts } from '@/lib/use-player-shortcuts'
import type { MeetingDetail } from '@shared/library'
import { mediaUrl } from '@shared/media'

/** Tempo para o player soltar o arquivo antes de a pasta ser renomeada (ms). */
const RELEASE_DELAY_MS = 300

/** Detalhe de uma Reunião: player com Anotações na linha do tempo e painel de abas. */
export function MeetingScreen() {
  const id = useMeetingId()
  if (!id) {
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
  return <MeetingLoader key={id} id={id} />
}

function MeetingLoader({ id }: { id: string }) {
  // A Reunião é relida quando a gravação muda de fase (ex.: terminou e deixou de estar bloqueada).
  const phase = useRecordingState().phase
  const { state, reload, updateNotes } = useMeetingDetail(id, phase)

  if (state.status === 'loading') {
    return (
      <Screen title="Reunião">
        <div className="text-muted-foreground grid h-full place-items-center">
          <LoaderCircle className="size-6 animate-spin" aria-label="Carregando a Reunião" />
        </div>
      </Screen>
    )
  }
  if (state.status === 'error') {
    return (
      <Screen title="Reunião">
        <EmptyState
          icon={TriangleAlert}
          title="Não foi possível abrir a Reunião"
          description={state.error}
          action={
            <Button asChild variant="outline">
              <a href="#/meetings">Ver Reuniões</a>
            </Button>
          }
        />
      </Screen>
    )
  }
  return <MeetingView detail={state.detail} reload={reload} updateNotes={updateNotes} />
}

function pickMedia(detail: MeetingDetail, suspended: boolean): PlayerMedia {
  if (detail.hasVideoFile) {
    return {
      kind: 'video',
      src: suspended ? null : mediaUrl(detail.folderName, 'video.mp4')
    }
  }
  if (detail.hasAudioFile) {
    return {
      kind: 'audio',
      src: suspended ? null : mediaUrl(detail.folderName, 'audio.opus')
    }
  }
  return { kind: 'none' }
}

function playerText(detail: MeetingDetail): string {
  if (!detail.hasVideoFile && !detail.hasAudioFile) {
    return 'Os arquivos de áudio e vídeo desta Reunião não estão disponíveis.'
  }
  return detail.source.kind === 'none'
    ? 'Reunião só de áudio'
    : 'O vídeo desta Reunião não está disponível. Tocando só o áudio.'
}

function MeetingView({
  detail,
  reload,
  updateNotes
}: {
  detail: MeetingDetail
  reload: () => Promise<void>
  updateNotes: (update: (notes: MeetingDetail['notes']) => MeetingDetail['notes']) => void
}) {
  const [controller] = useState(() => new PlayerController(detail.durationMs))
  const [suspended, setSuspended] = useState(false)
  const [folderNotice, setFolderNotice] = useState(false)
  usePlayerShortcuts(controller, true)

  const locked = detail.lock !== null
  const transcript = useTranscriptView(detail.id, detail.transcript)
  const transcribing = transcript.status === 'running'
  const summary = useSummaryView(detail.id, detail.summary)
  const summarizing = summary.status === 'running'

  /** Solta o arquivo, renomeia (nome + pasta) e volta a tocar do mesmo ponto. */
  const rename = async (name: string): Promise<string | null> => {
    setFolderNotice(false)
    setSuspended(true)
    await new Promise((resolve) => setTimeout(resolve, RELEASE_DELAY_MS))
    try {
      const result = await window.api.invoke('meeting:rename', { folder: detail.folder, name })
      if (!result.ok) return result.error.message
      if (!result.value.folderRenamed) setFolderNotice(true)
      await reload()
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    } finally {
      setSuspended(false)
    }
  }

  const player = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <MediaPlayer
          controller={controller}
          media={pickMedia(detail, suspended)}
          notes={detail.notes}
          audioOnlyText={playerText(detail)}
        />
      </div>
      {detail.issues.length > 0 && (
        <ul className="border-border text-muted-foreground shrink-0 space-y-1 border-t px-4 py-2 text-xs">
          {detail.issues.map((issue, index) => (
            <li key={`${issue.code}-${issue.atMs}-${index}`} className="flex items-center gap-1.5">
              <Info className="size-3.5 shrink-0" aria-hidden />
              {issueText(issue)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  const panel = (
    <SidePanel
      noteCount={detail.notes.length}
      hasSummary={summary.status === 'running' || summary.status === 'ready'}
      hasTranscript={transcript.status === 'running' || transcript.status === 'ready'}
      summary={
        <SummaryTab
          folder={detail.folder}
          meetingName={detail.name}
          locked={locked}
          hasAudioFile={detail.hasAudioFile}
          view={summary}
          transcript={transcript}
          controller={controller}
        />
      }
      ask={
        <ChatTab
          folder={detail.folder}
          meetingId={detail.id}
          durationMs={detail.durationMs}
          locked={locked}
          transcript={transcript}
          controller={controller}
        />
      }
      transcript={
        <TranscriptTab
          folder={detail.folder}
          locked={locked}
          hasAudioFile={detail.hasAudioFile}
          view={transcript}
          controller={controller}
        />
      }
      notes={
        <NotesTab
          folder={detail.folder}
          notes={detail.notes}
          locked={locked}
          controller={controller}
          onNotesChange={updateNotes}
          onStale={() => void reload()}
        />
      }
    />
  )

  return (
    <section aria-labelledby="screen-title" className="flex h-full min-h-0 flex-col">
      <MeetingHeader
        detail={detail}
        canRename={!locked && !transcribing && !summarizing}
        onRename={rename}
      />
      {detail.lock && (
        <Alert className="border-warning/40 text-warning mx-4 my-3 w-auto shrink-0">
          <TriangleAlert aria-hidden />
          <AlertTitle>{LOCK_TEXT[detail.lock].title}</AlertTitle>
          <AlertDescription>{LOCK_TEXT[detail.lock].detail}</AlertDescription>
        </Alert>
      )}
      {folderNotice && (
        <Alert className="border-warning/40 text-warning mx-4 my-3 w-auto shrink-0">
          <TriangleAlert aria-hidden />
          <AlertTitle>O nome foi salvo, mas a pasta mantém o nome antigo</AlertTitle>
          <AlertDescription>
            Algum programa está usando a pasta da Reunião (antivírus, sincronização ou o
            Explorador). Feche-o e renomeie de novo para a pasta acompanhar o nome.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <SplitLayout player={player} panel={panel} />
      </div>
    </section>
  )
}
