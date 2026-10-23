import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatDateTime } from '@/lib/format'
import { meetingHref } from '@/lib/router'
import {
  DEFAULT_SCOPE,
  MAX_SCOPE_MEETINGS,
  SCOPE_MAX_OPTIONS,
  SCOPE_PERIOD_OPTIONS,
  listScopeMeetings,
  setMeetingIncluded,
  type GroupScope,
  type ScopeCandidate,
  type ScopeResolution
} from '@shared/group-chat'

const ALL_PERIOD = 'all'

function periodValue(days: number | null): string {
  return days === null ? ALL_PERIOD : String(days)
}

function periodLabel(days: number | null): string {
  return days === null ? 'Tudo' : `${days} dias`
}

function periodPhrase(days: number | null): string {
  return days === null ? 'todo o período' : `últimos ${days} dias`
}

function shortDate(iso: string): string {
  return formatDateTime(iso).slice(0, 5)
}

interface ScopeMenuProps {
  scope: GroupScope
  meetings: readonly ScopeCandidate[]
  resolution: ScopeResolution
  nowMs: number
  disabled: boolean
  onChange: (scope: GroupScope) => void
}

/** Escopo da pergunta numa linha ("5 Reuniões · últimos 30 dias"); clicar abre os ajustes. */
export function ScopeMenu({
  scope,
  meetings,
  resolution,
  nowMs,
  disabled,
  onChange
}: ScopeMenuProps) {
  const [showOlder, setShowOlder] = useState(false)
  const { selected, missing, chosen, capped } = resolution
  const chosenIds = new Set(chosen.map((meeting) => meeting.id))
  const listing = listScopeMeetings(meetings, scope, resolution, nowMs)
  const isDefault =
    scope.periodDays === DEFAULT_SCOPE.periodDays &&
    scope.maxMeetings === DEFAULT_SCOPE.maxMeetings &&
    scope.include.length === 0 &&
    scope.exclude.length === 0
  const count = selected.length === 1 ? '1 Reunião' : `${selected.length} Reuniões`

  const row = (meeting: ScopeCandidate) => {
    const checked = chosenIds.has(meeting.id)
    return (
      <li key={meeting.id}>
        <label className="hover:bg-accent/50 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled || (!checked && chosen.length >= MAX_SCOPE_MEETINGS)}
            className="accent-primary size-4 shrink-0 cursor-pointer disabled:cursor-not-allowed"
            onChange={(event) =>
              onChange(setMeetingIncluded(scope, meetings, nowMs, meeting.id, event.target.checked))
            }
          />
          <span className="min-w-0 flex-1 truncate">{meeting.name}</span>
          {meeting.hasTranscript ? (
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {shortDate(meeting.createdAt)}
            </span>
          ) : (
            <a
              href={meetingHref(meeting.id)}
              className="text-muted-foreground shrink-0 text-xs underline-offset-2 hover:underline"
            >
              Sem Transcrição
            </a>
          )}
        </label>
      </li>
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground -ml-2 font-normal"
          aria-label="Escopo da pergunta"
        >
          {selected.length === 0 ? 'Nenhuma Reunião' : count} · {periodPhrase(scope.periodDays)}
          <ChevronDown aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-4">
        <section className="space-y-1.5">
          <h3 className="text-muted-foreground text-xs">Período</h3>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={disabled}
            value={periodValue(scope.periodDays)}
            onValueChange={(value) => {
              if (value !== '') {
                onChange({ ...scope, periodDays: value === ALL_PERIOD ? null : Number(value) })
              }
            }}
          >
            {SCOPE_PERIOD_OPTIONS.map((days) => (
              <ToggleGroupItem key={periodValue(days)} value={periodValue(days)} className="flex-1">
                {periodLabel(days)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </section>

        <section className="space-y-1.5">
          <h3 className="text-muted-foreground text-xs">Até</h3>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={disabled}
            value={String(scope.maxMeetings)}
            onValueChange={(value) => {
              if (value !== '') onChange({ ...scope, maxMeetings: Number(value) })
            }}
          >
            {SCOPE_MAX_OPTIONS.map((max) => (
              <ToggleGroupItem key={max} value={String(max)} className="flex-1">
                {max}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </section>

        <section className="space-y-1.5">
          <h3 className="text-muted-foreground text-xs">Reuniões</h3>
          {meetings.length === 0 ? (
            <p className="text-muted-foreground text-sm">O grupo não tem Reuniões.</p>
          ) : (
            <div className="-mx-2 max-h-56 overflow-y-auto">
              <ul>{listing.main.map(row)}</ul>
              {listing.older.length > 0 && (
                <>
                  <button
                    type="button"
                    aria-expanded={showOlder}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1.5 text-xs"
                    onClick={() => setShowOlder((current) => !current)}
                  >
                    {showOlder ? (
                      <ChevronDown className="size-3" aria-hidden />
                    ) : (
                      <ChevronRight className="size-3" aria-hidden />
                    )}
                    Mais antigas ({listing.older.length})
                  </button>
                  {showOlder && <ul>{listing.older.map(row)}</ul>}
                </>
              )}
            </div>
          )}
          {(missing.length > 0 || capped) && (
            <p className="text-muted-foreground text-xs">
              {missing.length > 0 &&
                `${missing.length} sem Transcrição ${missing.length === 1 ? 'fica' : 'ficam'} de fora. `}
              {capped && `O máximo é ${MAX_SCOPE_MEETINGS} por pergunta.`}
            </p>
          )}
        </section>

        <div className="flex justify-end">
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled || isDefault}
            onClick={() => onChange({ ...DEFAULT_SCOPE, include: [], exclude: [] })}
          >
            Restaurar padrão
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
