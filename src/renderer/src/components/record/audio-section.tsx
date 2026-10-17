import { Mic, Volume2 } from 'lucide-react'
import { LevelMeter } from '@/components/record/level-meter'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { NO_MIC, useMicPreviewLevel, type MicDevice } from '@/lib/microphone'

interface AudioSectionProps {
  devices: MicDevice[]
  problem: string | null
  /** `NO_MIC` ou o `deviceId` escolhido (já resolvido). */
  choice: string
  systemAudio: boolean
  disabled?: boolean
  onChange: (choice: string) => void
  onSystemAudioChange: (enabled: boolean) => void
}

function deviceLabel(device: MicDevice, index: number): string {
  const label = device.label || `Microfone ${index + 1}`
  return device.isDefault ? `${label} (padrão)` : label
}

/** Microfone com medidor ao vivo e a chave do áudio do sistema. */
export function AudioSection({
  devices,
  problem,
  choice,
  systemAudio,
  disabled,
  onChange,
  onSystemAudioChange
}: AudioSectionProps) {
  const level = useMicPreviewLevel(choice === NO_MIC || disabled ? null : choice)

  return (
    <section className="space-y-4" aria-labelledby="audio-title">
      <h2 id="audio-title" className="text-sm font-semibold tracking-tight">
        Áudio
      </h2>

      <div className="bg-card border-border divide-border divide-y rounded-xl border">
        <div className="space-y-3 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <span className="bg-accent text-accent-foreground grid size-8 shrink-0 place-items-center rounded-lg">
              <Mic className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Microfone</div>
              <div className="text-muted-foreground text-xs">
                {choice !== NO_MIC
                  ? 'Fale algo para ver o nível.'
                  : systemAudio
                    ? 'Só o áudio do sistema será gravado.'
                    : 'O microfone não será gravado.'}
              </div>
            </div>
          </div>
          <Select value={choice} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger className="w-full" aria-label="Microfone">
              <SelectValue placeholder="Escolha um microfone" />
            </SelectTrigger>
            <SelectContent>
              {devices.map((device, index) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {deviceLabel(device, index)}
                </SelectItem>
              ))}
              <SelectItem value={NO_MIC}>Sem microfone</SelectItem>
            </SelectContent>
          </Select>
          <LevelMeter level={level} label="Nível do microfone" />
          {problem && <p className="text-warning text-xs">{problem}</p>}
        </div>

        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="bg-accent text-accent-foreground grid size-8 shrink-0 place-items-center rounded-lg">
            <Volume2 className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <label htmlFor="system-audio" className="block text-sm font-medium">
              Áudio do sistema
            </label>
            <div className="text-muted-foreground text-xs">
              {systemAudio
                ? 'A voz de quem fala na reunião entra na gravação (junto com notificações e músicas).'
                : 'O som do computador não será gravado.'}
            </div>
          </div>
          <Switch
            id="system-audio"
            checked={systemAudio}
            disabled={disabled}
            onCheckedChange={onSystemAudioChange}
          />
        </div>
      </div>
    </section>
  )
}
