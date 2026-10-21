import { HardDrive } from 'lucide-react'
import { useState } from 'react'
import { GroupsPanel } from '@/components/groups/groups-overview'
import { Screen } from '@/components/layout/screen'
import { CleanupDialog } from '@/components/library/cleanup-dialog'
import { LibraryBrowser } from '@/components/library/library-browser'
import { Button } from '@/components/ui/button'
import { useGroups } from '@/lib/groups'
import {
  GROUPS_VIEW_HREF,
  hrefFor,
  useMeetingsGroup,
  useMeetingsView,
  type MeetingsView
} from '@/lib/router'
import { cn } from '@/lib/utils'

const VIEWS: { view: MeetingsView; label: string; href: string }[] = [
  { view: 'all', label: 'Todas', href: hrefFor('meetings') },
  { view: 'groups', label: 'Grupos', href: GROUPS_VIEW_HREF }
]

/** Alternância "Todas | Grupos" da tela Reuniões (a aba fica no endereço, então o Voltar a respeita). */
function ViewSwitch({ view }: { view: MeetingsView }) {
  return (
    <nav
      aria-label="Ver Reuniões"
      className="bg-muted text-muted-foreground inline-flex h-8 items-center rounded-lg p-[3px]"
    >
      {VIEWS.map((item) => (
        <a
          key={item.view}
          href={item.href}
          aria-current={item.view === view ? 'page' : undefined}
          className={cn(
            'focus-visible:ring-ring/60 inline-flex h-full items-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2',
            item.view === view ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground'
          )}
        >
          {item.label}
        </a>
      ))}
    </nav>
  )
}

/** Reuniões: a lista geral (busca e filtros) ou os grupos. */
export function MeetingsScreen() {
  const view = useMeetingsView()
  const group = useMeetingsGroup()
  const [cleaning, setCleaning] = useState(false)
  const groups = useGroups()

  return (
    <Screen
      title="Reuniões"
      actions={
        <div className="flex items-center gap-3">
          <ViewSwitch view={view} />
          <Button variant="outline" size="sm" onClick={() => setCleaning(true)}>
            <HardDrive aria-hidden />
            Liberar espaço
          </Button>
        </div>
      }
    >
      <CleanupDialog open={cleaning} onOpenChange={setCleaning} />
      {view === 'groups' ? (
        <GroupsPanel state={groups} />
      ) : (
        <LibraryBrowser key={group ?? 'all'} initialGroup={group} />
      )}
    </Screen>
  )
}
