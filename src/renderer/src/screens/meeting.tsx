import { Info, LoaderCircle, MicOff, NotebookText, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState } from '@/components/empty-state'
import { DeleteVideoDialog } from '@/components/library/delete-video-dialog'
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
import { useContentArea } from '@/lib/content-area'
import { useMeetingDetail } from '@/lib/meetings'
import { PlayerController } from '@/lib/player-controller'
import { loadPositions, loadPrefs, resumeInstant, savePrefs } from '@/lib/player-prefs'
import { useRecordingState } from '@/lib/recording'
import { useMeetingId, useMeetingStart } from '@/lib/router'
import { useSummaryView } from '@/lib/summary'
import { useTranscriptView } from '@/lib/transcript'
import { usePlaybackMemory } from '@/lib/use-playback-memory'
import { NO_AUDIO_NOTICE } from '@shared/audio-inputs'
import { LIST_BLOCK_TEXT, type MeetingDetail } from '@shared/library'
import { mediaUrl } from '@shared/media'

/** Tempo para o player soltar o arquivo antes de a pasta ser renomeada (ms). */
const RELEASE_DELAY_MS = 300

/** Detalhe de uma Reunião: player com Anotações na linha do tempo e painel de abas. */
export function MeetingScreen() {
  const id = useMeetingId()
  const startMs = useMeetingStart()
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
  return <MeetingLoader key={id} id={id} startMs={startMs} />
}

function MeetingLoader({ id, startMs }: { id: string; startMs: number | null }) {
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
  return (
    <MeetingView
      detail={state.detail}
      startMs={startMs}
      reload={reload}
      updateNotes={updateNotes}
    />
  )
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
  startMs,
  reload,
  updateNotes
}: {
  detail: MeetingDetail
  /** Instante em que o player abre (vindo de um trecho achado na busca). */
  startMs: number | null
  reload: () => Promise<void>
  updateNotes: (update: (notes: MeetingDetail['notes']) => MeetingDetail['notes']) => void
}) {
  const [controller] = useState(() => {
    const created = new PlayerController(detail.durationMs, loadPrefs(), savePrefs)
    // Instante pedido na rota; sem ele, retoma de onde a Reunião parou. O seek fica guardado
    // até o arquivo carregar.
    const initial = startMs ?? resumeInstant(loadPositions(), detail.id, detail.durationMs)
    if (initial !== null) created.seekToMs(initial)
    return created
  })
  const [suspended, setSuspended] = useState(false)
  const [folderNotice, setFolderNotice] = useState(false)
  const [confirmingVideoDelete, setConfirmingVideoDelete] = useState(false)
  usePlaybackMemory(controller, detail.id)
  const contentArea = useContentArea(detail.folder, detail.hasVideoFile, detail.compactionStatus)

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

  /** Solta o arquivo de vídeo para o app poder trocá-lo ou enviá-lo para a Lixeira. */
  const releaseMedia = async (): Promise<void> => {
    setSuspended(true)
    await new Promise((resolve) => setTimeout(resolve, RELEASE_DELAY_MS))
  }

  // A Compactação troca o arquivo do Vídeo: o player reabre o novo ao terminar.
  useEffect(() => {
    return window.api.on('compaction:changed', (event) => {
      if (event.meetingId !== detail.id) return
      // O andamento chega várias vezes; só o início e o fim mudam a tela.
      if (event.status === 'running' && event.percent !== null && event.percent > 0) return
      if (event.status !== 'done') {
        void reload()
        return
      }
      void (async () => {
        await releaseMedia()
        await reload()
        setSuspended(false)
      })()
    })
  }, [detail.id, reload])

  const compacting = detail.compactionStatus === 'running'
  const deleteVideoBlock = detail.lock
    ? LOCK_TEXT[detail.lock].title
    : compacting
      ? LIST_BLOCK_TEXT.compacting
      : null

  const player = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <MediaPlayer
          controller={controller}
          media={pickMedia(detail, suspended)}
          notes={detail.notes}
          audioOnlyText={playerText(detail)}
          contentArea={contentArea}
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

  const noAudio = <EmptyState icon={MicOff} title="Sem áudio" description={NO_AUDIO_NOTICE} />

  const panel = (
    <SidePanel
      noteCount={detail.notes.length}
      hasSummary={summary.status === 'running' || summary.status === 'ready'}
      hasTranscript={transcript.status === 'running' || transcript.status === 'ready'}
      summary={
        detail.hasAudioInput ? (
          <SummaryTab
            folder={detail.folder}
            meetingName={detail.name}
            locked={locked}
            hasAudioFile={detail.hasAudioFile}
            view={summary}
            transcript={transcript}
            controller={controller}
          />
        ) : (
          noAudio
        )
      }
      ask={
        detail.hasAudioInput ? (
          <ChatTab
            folder={detail.folder}
            meetingId={detail.id}
            durationMs={detail.durationMs}
            locked={locked}
            transcript={transcript}
            controller={controller}
          />
        ) : (
          noAudio
        )
      }
      transcript={
        detail.hasAudioInput ? (
          <TranscriptTab
            folder={detail.folder}
            locked={locked}
            hasAudioFile={detail.hasAudioFile}
            view={transcript}
            controller={controller}
          />
        ) : (
          noAudio
        )
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
        canRename={!locked && !transcribing && !summarizing && !compacting}
        onRename={rename}
        deleteVideo={
          detail.hasVideoFile && detail.hasAudioFile
            ? {
                blockedReason: deleteVideoBlock,
                onClick: () => setConfirmingVideoDelete(true)
              }
            : null
        }
      />
      <DeleteVideoDialog
        open={confirmingVideoDelete}
        onOpenChange={setConfirmingVideoDelete}
        folder={detail.folder}
        name={detail.name}
        prepare={releaseMedia}
        onFinished={(deleted) => {
          if (deleted) void reload().finally(() => setSuspended(false))
          else setSuspended(false)
        }}
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
