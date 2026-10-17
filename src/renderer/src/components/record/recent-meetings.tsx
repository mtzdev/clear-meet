import { StatusBadge } from '@/components/library/status-badge'
import { formatDateTime, formatDuration } from '@/lib/format'
import { useLibraryQuery } from '@/lib/library'
import { meetingHref } from '@/lib/router'
import { DEFAULT_LIBRARY_QUERY, type LibraryQuery } from '@shared/library'

const RECENT_COUNT = 5
const RECENT_QUERY: LibraryQuery = { ...DEFAULT_LIBRARY_QUERY, limit: RECENT_COUNT }

/** As Reuniões mais recentes, na tela Gravar; some enquanto não há nenhuma. */
export function RecentMeetings() {
  const { data } = useLibraryQuery(RECENT_QUERY)
  if (!data || data.entries.length === 0) return null

  return (
    <section className="space-y-3" aria-labelledby="recent-title">
      <div className="flex items-center justify-between gap-4">
        <h2 id="recent-title" className="text-sm font-semibold tracking-tight">
          Últimas Reuniões
        </h2>
        <a
          href="#/meetings"
          className="text-primary focus-visible:ring-ring/60 rounded text-xs font-medium outline-none hover:underline focus-visible:ring-2"
        >
          Ver todas
        </a>
      </div>
      <ul className="border-border divide-border divide-y rounded-xl border">
        {data.entries.map(({ meeting }) => (
          <li key={meeting.id}>
            <a
              href={meetingHref(meeting.id)}
              className="hover:bg-accent/50 focus-visible:ring-ring/60 flex items-center gap-3 px-4 py-2.5 outline-none first:rounded-t-xl last:rounded-b-xl focus-visible:ring-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{meeting.name}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {[
                    formatDateTime(meeting.createdAt),
                    meeting.durationMs !== null ? formatDuration(meeting.durationMs) : null
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <StatusBadge item={meeting} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
