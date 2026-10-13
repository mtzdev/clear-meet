import { Pencil, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePlayerValue, type PlayerController } from '@/lib/player-controller'
import type { TranscriptActions } from '@/lib/transcript'
import { cn } from '@/lib/utils'
import { formatInstant } from '@shared/timeline'
import {
  currentUtteranceIndex,
  findMatches,
  genericSpeakerNumber,
  speakerColorIndex,
  speakerLabel,
  speakerStats,
  type Speaker,
  type TranscriptFile,
  type Utterance
} from '@shared/transcript'

interface TranscriptListProps {
  folder: string
  transcript: TranscriptFile
  controller: PlayerController
  actions: TranscriptActions
  summaryRequested: boolean
  /** Uma Transcrição mais nova (Falante renomeado) substitui a mostrada. */
  onReplace: (transcript: TranscriptFile) => void
}

function colorOf(speakers: readonly Speaker[], id: string): string {
  return `var(--speaker-${speakerColorIndex(speakers, id) + 1})`
}

/** "Falante 2" vira "2"; um nome vira a inicial. */
function initialOf(label: string): string {
  const number = genericSpeakerNumber(label)
  return number !== null ? String(number) : (Array.from(label)[0]?.toUpperCase() ?? '?')
}

function Avatar({ label, color }: { label: string; color: string }) {
  return (
    <span
      aria-hidden
      className="grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` }}
    >
      {initialOf(label)}
    </span>
  )
}

/** Nome do Falante que vira um campo de texto ao clicar (Enter salva, Esc cancela). */
function SpeakerName({
  speaker,
  color,
  className,
  editing,
  onEdit,
  onSave
}: {
  speaker: Speaker
  color: string
  className?: string
  editing: boolean
  onEdit: (editing: boolean) => void
  onSave: (name: string) => Promise<string | null>
}) {
  const label = speakerLabel(speaker)
  const [value, setValue] = useState(speaker.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (!editing) {
    return (
      <button
        type="button"
        title="Renomear o Falante"
        className={cn(
          'group focus-visible:ring-ring/60 inline-flex cursor-pointer items-center gap-1 rounded outline-none focus-visible:ring-2',
          className
        )}
        style={{ color }}
        onClick={() => {
          setValue(speaker.name ?? '')
          setError(null)
          onEdit(true)
        }}
      >
        <span className="truncate hover:underline">{label}</span>
        <Pencil
          className="size-3 opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70"
          aria-hidden
        />
      </button>
    )
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    const failure = await onSave(value)
    setSaving(false)
    if (failure) setError(failure)
    else onEdit(false)
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <Input
        value={value}
        autoFocus
        disabled={saving}
        maxLength={60}
        aria-label={`Nome do ${label}`}
        placeholder={label}
        className="h-7 w-44 px-2 text-xs"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setValue(event.target.value)
          setError(null)
        }}
        onBlur={() => {
          if (!saving) onEdit(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void save()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onEdit(false)
          }
        }}
      />
      {error && (
        <span role="alert" className="text-destructive text-xs font-normal">
          {error}
        </span>
      )}
    </span>
  )
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const matches = findMatches(text, query)
  if (matches.length === 0) return <>{text}</>
  const parts: ReactNode[] = []
  let cursor = 0
  for (const [start, end] of matches) {
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(
      <mark key={start} className="bg-warning/30 text-foreground rounded-sm">
        {text.slice(start, end)}
      </mark>
    )
    cursor = end
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

export function TranscriptList({
  folder,
  transcript,
  controller,
  actions,
  summaryRequested,
  onReplace
}: TranscriptListProps) {
  const { utterances, speakers, durationMs } = transcript
  const [query, setQuery] = useState('')
  const [follow, setFollow] = useState(true)
  const [confirmRedo, setConfirmRedo] = useState(false)
  const [redoError, setRedoError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const currentIndex = usePlayerValue(controller, (snapshot) =>
    currentUtteranceIndex(utterances, snapshot.currentMs)
  )
  const searching = query.trim() !== ''
  const speakerById = useMemo(
    () => new Map(speakers.map((speaker) => [speaker.id, speaker])),
    [speakers]
  )
  const stats = useMemo(
    () => speakerStats(speakers, utterances, durationMs),
    [speakers, utterances, durationMs]
  )
  const shown = useMemo(
    () =>
      utterances
        .map((utterance, index) => ({ utterance, index }))
        .filter(({ utterance }) => !searching || findMatches(utterance.text, query).length > 0),
    [utterances, query, searching]
  )

  useEffect(() => {
    if (!follow || searching || currentIndex < 0) return
    const list = listRef.current
    const row = list?.querySelector<HTMLElement>(`[data-index="${currentIndex}"]`)
    if (!list || !row) return
    list.scrollTo({ top: row.offsetTop - list.clientHeight / 3, behavior: 'smooth' })
  }, [currentIndex, follow, searching])

  // Rolar ou tocar na barra de rolagem pausa o acompanhamento; só o botão (ou clicar num Instante) o retoma.
  const pauseFollow = (): void => setFollow(false)

  const goTo = (utterance: Utterance): void => {
    controller.seekToMs(utterance.startMs)
    setFollow(true)
  }

  const rename = async (speakerId: string, name: string): Promise<string | null> => {
    const result = await window.api.invoke('transcript:renameSpeaker', {
      folder,
      speakerId,
      name
    })
    if (!result.ok) return result.error.message
    onReplace(result.value)
    return null
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="border-border shrink-0 space-y-2.5 border-b p-3">
        <ul
          className="flex max-h-24 flex-wrap gap-x-3 gap-y-1.5 overflow-y-auto"
          aria-label="Falantes"
        >
          {speakers.map((speaker) => {
            const stat = stats.find((candidate) => candidate.id === speaker.id)
            const color = colorOf(speakers, speaker.id)
            return (
              <li key={speaker.id} className="flex max-w-full min-w-0 items-center gap-1.5 text-xs">
                <Avatar label={speakerLabel(speaker)} color={color} />
                <SpeakerName
                  speaker={speaker}
                  color={color}
                  className="max-w-40 min-w-0 truncate font-semibold"
                  editing={editing === `legend:${speaker.id}`}
                  onEdit={(on) => setEditing(on ? `legend:${speaker.id}` : null)}
                  onSave={(name) => rename(speaker.id, name)}
                />
                {stat && (
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {formatInstant(stat.speakingMs)}
                  </span>
                )}
              </li>
            )
          })}
        </ul>

        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={query}
            placeholder="Buscar na Transcrição"
            aria-label="Buscar na Transcrição"
            className="pr-9 pl-8"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query !== '' && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
              aria-label="Limpar a busca"
              onClick={() => setQuery('')}
            >
              <X aria-hidden />
            </Button>
          )}
        </div>
        <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
          <span>
            {searching
              ? `${shown.length} ${shown.length === 1 ? 'Fala encontrada' : 'Falas encontradas'}`
              : `${utterances.length} ${utterances.length === 1 ? 'Fala' : 'Falas'}`}
          </span>
          {confirmRedo ? (
            <span className="flex flex-wrap items-center justify-end gap-1">
              <span>Substituir? Os nomes dados aos Falantes se perdem.</span>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setConfirmRedo(false)
                  void actions.start(summaryRequested).then(setRedoError)
                }}
              >
                Gerar de novo
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirmRedo(false)}>
                Cancelar
              </Button>
            </span>
          ) : (
            <Button size="xs" variant="ghost" onClick={() => setConfirmRedo(true)}>
              Gerar de novo
            </Button>
          )}
        </div>
        {redoError && (
          <p role="alert" className="text-destructive text-xs">
            {redoError}
          </p>
        )}
      </div>

      <div
        ref={listRef}
        className="relative min-h-0 flex-1 overflow-y-auto"
        onWheel={pauseFollow}
        onTouchMove={pauseFollow}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) pauseFollow()
        }}
      >
        {utterances.length === 0 ? (
          <p className="text-muted-foreground px-6 py-12 text-center text-sm">
            A IA não encontrou fala neste áudio.
          </p>
        ) : shown.length === 0 ? (
          <p className="text-muted-foreground px-6 py-12 text-center text-sm">
            Nada encontrado para “{query.trim()}”.
          </p>
        ) : (
          <ul className="py-1">
            {shown.map(({ utterance, index }, position) => {
              const speaker = speakerById.get(utterance.speakerId)
              const previous = shown[position - 1]?.utterance
              const newSpeaker = previous?.speakerId !== utterance.speakerId
              const color = colorOf(speakers, utterance.speakerId)
              return (
                <li
                  key={utterance.id}
                  data-index={index}
                  aria-current={index === currentIndex ? 'true' : undefined}
                  style={{ borderLeftColor: color }}
                  className={cn(
                    'border-l-4 px-4 text-sm',
                    newSpeaker ? 'pt-3' : 'pt-0.5',
                    newSpeaker && position > 0 && 'border-t-2 border-t-border mt-3',
                    index === currentIndex && 'bg-accent/60'
                  )}
                >
                  {newSpeaker && speaker && (
                    <div className="mb-1 flex items-center gap-2 text-xs">
                      <Avatar label={speakerLabel(speaker)} color={color} />
                      <SpeakerName
                        speaker={speaker}
                        color={color}
                        className="font-semibold"
                        editing={editing === `row:${utterance.id}`}
                        onEdit={(on) => setEditing(on ? `row:${utterance.id}` : null)}
                        onSave={(name) => rename(speaker.id, name)}
                      />
                    </div>
                  )}
                  <div className="flex gap-3 pb-1.5 pl-7">
                    <button
                      type="button"
                      className="text-primary focus-visible:ring-ring/60 mt-px h-fit shrink-0 cursor-pointer rounded text-xs font-medium tabular-nums outline-none hover:underline focus-visible:ring-2"
                      aria-label={`Ir para ${formatInstant(utterance.startMs)}`}
                      onClick={() => goTo(utterance)}
                    >
                      {formatInstant(utterance.startMs)}
                    </button>
                    <p className="min-w-0 flex-1 break-words whitespace-pre-wrap">
                      <Highlighted text={utterance.text} query={query} />
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {!follow && !searching && utterances.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button
            size="sm"
            className="pointer-events-auto shadow-md"
            onClick={() => setFollow(true)}
          >
            Voltar a acompanhar
          </Button>
        </div>
      )}
    </div>
  )
}
