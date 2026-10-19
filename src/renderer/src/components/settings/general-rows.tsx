import { FolderOpen } from 'lucide-react'
import { ChangeFolderButton } from '@/components/settings/change-folder'
import { Path, Row } from '@/components/settings/layout'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { QUALITY_OPTIONS } from '@/lib/quality'
import { useSettings } from '@/lib/recording'
import { isQualityPreset } from '@shared/capture'
import { isThemePreference, type ThemePreference } from '@shared/theme'

/** Qualidade do Vídeo: a mesma escolha da tela de Gravar. */
export function QualityRow() {
  const { settings, update } = useSettings()
  const current = QUALITY_OPTIONS.find((option) => option.value === settings?.quality)
  return (
    <Row label="Qualidade do vídeo" hint={current?.hint}>
      <Select
        value={settings?.quality ?? ''}
        disabled={!settings}
        onValueChange={(value) => {
          if (isQualityPreset(value)) update({ quality: value })
        }}
      >
        <SelectTrigger className="w-40" aria-label="Qualidade do vídeo">
          <SelectValue placeholder="Carregando…" />
        </SelectTrigger>
        <SelectContent>
          {QUALITY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  )
}

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' }
]

export function ThemeRow() {
  const { settings, update } = useSettings()
  return (
    <Row label="Tema" hint="Em “Sistema”, acompanha o modo claro ou escuro do Windows.">
      <Select
        value={settings?.theme ?? ''}
        disabled={!settings}
        onValueChange={(value) => {
          if (isThemePreference(value)) update({ theme: value })
        }}
      >
        <SelectTrigger className="w-40" aria-label="Tema">
          <SelectValue placeholder="Carregando…" />
        </SelectTrigger>
        <SelectContent>
          {THEMES.map((theme) => (
            <SelectItem key={theme.value} value={theme.value}>
              {theme.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  )
}

export function MeetingsFolderRow() {
  const { settings, reload } = useSettings()
  return (
    <Row
      label="Pasta das Reuniões"
      hint="Onde ficam o vídeo, o áudio, a Transcrição e as Anotações de cada Reunião."
    >
      <div className="flex flex-col items-end gap-3">
        <Path value={settings?.resolvedMeetingsDir ?? null} />
        <div className="flex items-start gap-2">
          <ChangeFolderButton onChanged={reload} disabled={!settings} />
          <Button
            variant="outline"
            size="sm"
            disabled={!settings}
            onClick={() => void window.api.invoke('meetingsDir:open', { which: 'current' })}
          >
            <FolderOpen aria-hidden />
            Abrir pasta
          </Button>
        </div>
      </div>
    </Row>
  )
}
