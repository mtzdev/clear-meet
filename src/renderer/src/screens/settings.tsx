import { Screen } from '@/components/layout/screen'
import { AiSection } from '@/components/settings/ai-section'
import { CompactionSection } from '@/components/settings/compaction-section'
import { MeetingsFolderRow, QualityRow, ThemeRow } from '@/components/settings/general-rows'
import { Section } from '@/components/settings/layout'
import { NoteSection } from '@/components/settings/note-section'
import { FfmpegRows, VersionRow } from '@/components/settings/system-section'

export function SettingsScreen() {
  return (
    <Screen title="Configurações">
      <div className="mx-auto max-w-2xl space-y-8 px-8 py-8">
        <Section title="Gravação">
          <QualityRow />
        </Section>
        <Section title="Anotações">
          <NoteSection />
        </Section>
        <Section title="IA">
          <AiSection />
        </Section>
        <Section title="Compactação">
          <CompactionSection />
        </Section>
        <Section title="Armazenamento">
          <MeetingsFolderRow />
        </Section>
        <Section title="Aparência">
          <ThemeRow />
        </Section>
        <Section title="Sistema">
          <VersionRow />
          <FfmpegRows />
        </Section>
      </div>
    </Screen>
  )
}
