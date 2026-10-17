import { Library, SearchX, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { EmptyState } from '@/components/empty-state'
import { Screen } from '@/components/layout/screen'
import { LibraryFilters } from '@/components/library/filters'
import { MeetingCard } from '@/components/library/meeting-card'
import { Button } from '@/components/ui/button'
import { dateRange, NO_DATE_FILTER, type DateFilter } from '@/lib/date-range'
import { useDebounced, useLibraryQuery } from '@/lib/library'
import type { LibraryQuery, LibrarySort } from '@shared/library'

const SEARCH_DEBOUNCE_MS = 250

/** Centraliza um estado vazio abaixo da barra de filtros. */
function Centered({ children }: { children: ReactNode }) {
  return <div className="min-h-[24rem]">{children}</div>
}

/** Lista e busca de Reuniões (nome, conversa, Anotações e Resumo), com filtro de datas. */
export function MeetingsScreen() {
  const [text, setText] = useState('')
  const [date, setDate] = useState<DateFilter>(NO_DATE_FILTER)
  const [sortChoice, setSortChoice] = useState<LibrarySort | null>(null)

  // Pastas mexidas fora do app aparecem ao abrir a tela.
  useEffect(() => {
    void window.api.invoke('library:refresh')
  }, [])

  const debouncedText = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS)
  const searching = text.trim() !== ''
  const sort: LibrarySort =
    sortChoice === 'relevance' && !searching
      ? 'newest'
      : (sortChoice ?? (searching ? 'relevance' : 'newest'))

  const range = useMemo(
    () => dateRange(date, new Date()),
    // O intervalo é calculado quando o filtro muda, não a cada renderização.
    [date]
  )
  const query: LibraryQuery = {
    text: debouncedText,
    fromMs: range.fromMs,
    toMs: range.toMs,
    sort,
    limit: null
  }
  const library = useLibraryQuery(query)
  const { data } = library

  const filtered = searching || date.preset !== 'all'
  const clearFilters = (): void => {
    setText('')
    setDate(NO_DATE_FILTER)
    setSortChoice(null)
  }

  return (
    <Screen title="Reuniões">
      <div className="bg-background/95 border-border sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto max-w-4xl px-8 py-4">
          <LibraryFilters
            text={text}
            onText={setText}
            date={date}
            onDate={setDate}
            sort={sort}
            onSort={setSortChoice}
            searching={searching}
          />
        </div>
      </div>

      {data === null && library.error !== null && (
        <Centered>
          <EmptyState
            icon={TriangleAlert}
            title="Não foi possível listar as Reuniões"
            description={library.error}
            action={
              <Button variant="outline" onClick={library.reload}>
                Tentar de novo
              </Button>
            }
          />
        </Centered>
      )}
      {data === null && library.error === null && (
        <p className="text-muted-foreground px-8 py-6 text-sm">Carregando as Reuniões…</p>
      )}

      {data !== null && data.indexed === 0 && data.updating && (
        <p className="text-muted-foreground px-8 py-6 text-sm">Carregando as Reuniões…</p>
      )}
      {data !== null && data.indexed === 0 && !data.updating && (
        <Centered>
          <EmptyState
            icon={Library}
            title="Nenhuma Reunião ainda"
            description="As Reuniões gravadas aparecem aqui, da mais recente para a mais antiga."
            action={
              <Button asChild variant="outline">
                <a href="#/record">Ir para Gravar</a>
              </Button>
            }
          />
        </Centered>
      )}
      {data !== null && data.indexed > 0 && data.entries.length === 0 && (
        <Centered>
          <EmptyState
            icon={SearchX}
            title="Nenhuma Reunião encontrada"
            description="Tente outras palavras ou mude o período."
            action={
              filtered ? (
                <Button variant="outline" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              ) : undefined
            }
          />
        </Centered>
      )}
      {data !== null && data.entries.length > 0 && (
        <div className="mx-auto max-w-4xl space-y-4 px-8 py-5">
          {filtered && (
            <p className="text-muted-foreground text-xs" role="status">
              {data.total} {data.total === 1 ? 'Reunião encontrada' : 'Reuniões encontradas'}
            </p>
          )}
          <ul className="space-y-2.5">
            {data.entries.map((entry) => (
              <MeetingCard key={entry.meeting.id} entry={entry} />
            ))}
          </ul>
          {data.total > data.entries.length && (
            <p className="text-muted-foreground text-xs">
              Mostrando {data.entries.length} de {data.total} Reuniões. Refine a busca para ver as
              demais.
            </p>
          )}
          {data.skipped > 0 && (
            <p className="text-muted-foreground text-xs">
              {data.skipped === 1
                ? '1 pasta foi ignorada porque não pôde ser lida.'
                : `${data.skipped} pastas foram ignoradas porque não puderam ser lidas.`}{' '}
              Nada foi alterado nelas.
            </p>
          )}
        </div>
      )}
    </Screen>
  )
}
