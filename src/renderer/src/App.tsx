import type { ReactElement } from 'react'
import { Sidebar } from '@/components/layout/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useRoute, type Route } from '@/lib/router'
import { MeetingScreen } from '@/screens/meeting'
import { MeetingsScreen } from '@/screens/meetings'
import { RecordScreen } from '@/screens/record'
import { SettingsScreen } from '@/screens/settings'

const SCREENS: Record<Route, () => ReactElement> = {
  record: RecordScreen,
  meetings: MeetingsScreen,
  meeting: MeetingScreen,
  settings: SettingsScreen
}

export function App() {
  const route = useRoute()
  const Screen = SCREENS[route]

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-full">
        <Sidebar route={route} />
        <main className="min-w-0 flex-1">
          <Screen />
        </main>
      </div>
    </TooltipProvider>
  )
}
