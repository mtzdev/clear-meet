import {
  AudioLines,
  CircleDot,
  Library,
  NotebookText,
  Settings,
  type LucideIcon
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { hrefFor, type Route } from '@/lib/router'
import { cn } from '@/lib/utils'

interface NavItem {
  route: Route
  label: string
  icon: LucideIcon
}

const MAIN_ITEMS: NavItem[] = [
  { route: 'record', label: 'Gravar', icon: CircleDot },
  { route: 'meetings', label: 'Reuniões', icon: Library },
  { route: 'meeting', label: 'Reunião', icon: NotebookText }
]

const SETTINGS_ITEM: NavItem = { route: 'settings', label: 'Configurações', icon: Settings }

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={hrefFor(item.route)}
          aria-label={item.label}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'relative grid size-10 place-items-center rounded-xl transition-colors outline-none',
            'focus-visible:ring-ring/60 focus-visible:ring-2',
            active
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
          )}
        >
          {active && (
            <span
              aria-hidden
              className="bg-primary absolute top-2.5 -left-2 h-5 w-1 rounded-r-full"
            />
          )}
          <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
        </a>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {item.label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Barra lateral fina, só com ícones; o nome de cada área aparece em tooltip. */
export function Sidebar({ route }: { route: Route }) {
  return (
    <nav
      aria-label="Navegação principal"
      className="bg-sidebar border-sidebar-border flex w-16 shrink-0 flex-col items-center gap-1.5 border-r py-3"
    >
      <div
        aria-hidden
        className="bg-primary text-primary-foreground mb-3 grid size-9 place-items-center rounded-xl"
      >
        <AudioLines className="size-5" />
      </div>
      {MAIN_ITEMS.map((item) => (
        <NavLink
          key={item.route}
          item={item}
          active={route === item.route || (item.route === 'meetings' && route === 'group')}
        />
      ))}
      <div className="mt-auto">
        <NavLink item={SETTINGS_ITEM} active={route === SETTINGS_ITEM.route} />
      </div>
    </nav>
  )
}
