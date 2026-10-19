import type { ReactNode } from 'react'
import { SetupWizard } from '@/components/setup/setup-wizard'
import { useSettings } from '@/lib/recording'

/** Mostra a configuração inicial no lugar do app enquanto ela não foi concluída. */
export function SetupGate({ children }: { children: ReactNode }) {
  const { settings, update } = useSettings()
  if (!settings) return <div className="bg-background h-full" />
  if (!settings.setupCompleted) {
    return <SetupWizard onFinish={() => update({ setupCompleted: true })} />
  }
  return <>{children}</>
}
