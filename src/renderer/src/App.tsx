import { useEffect, type ReactElement } from 'react'
import { Sidebar } from '@/components/layout/sidebar'
import { SetupGate } from '@/components/setup/setup-gate'
import { UpdateBanner } from '@/components/layout/update-banner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useRecordingState } from '@/lib/recording'
import { navigate, useRoute, type Route } from '@/lib/router'
import { GroupScreen } from '@/screens/group'
import { MeetingScreen } from '@/screens/meeting'
import { MeetingsScreen } from '@/screens/meetings'
import { RecordScreen } from '@/screens/record'
import { SettingsScreen } from '@/screens/settings'

const SCREENS: Record<Route, () => ReactElement> = {
  record: RecordScreen,
  meetings: MeetingsScreen,
  meeting: MeetingScreen,
  group: GroupScreen,
  settings: SettingsScreen
}

export function App() {
  const route = useRoute()
  const recording = useRecordingState().phase
  // A janela principal fica oculta enquanto a barra flutuante grava; ao parar, volta na tela
  // de Gravar (finalização e resultado), mesmo que estivesse em outra área.
  useEffect(() => {
    if (recording === 'finalizing') navigate('record')
  }, [recording])
  const Screen = SCREENS[route]

  return (
    <TooltipProvider delayDuration={250}>
      <SetupGate>
        <div className="flex h-full">
          <Sidebar route={route} />
          <main className="min-w-0 flex-1">
            <Screen />
          </main>
        </div>
      </SetupGate>
      <UpdateBanner />
    </TooltipProvider>
  )
}
