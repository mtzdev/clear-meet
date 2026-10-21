import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { RulesDraft } from '@/lib/group-rules-draft'
import { cn } from '@/lib/utils'
import { MAX_RULE_TEXT_LENGTH, WEEKDAY_ORDER, WEEKDAY_SHORT } from '@shared/groups'
import { hasTag, type TagInfo } from '@shared/tags'

const ANY_TAG = '__any__'

interface RulesEditorProps {
  draft: RulesDraft
  onChange: (draft: RulesDraft) => void
  tags: readonly TagInfo[]
  disabled?: boolean
}

function Field({
  label,
  htmlFor,
  children
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] items-center gap-3">
      <Label htmlFor={htmlFor} className="text-muted-foreground text-xs font-normal">
        {label}
      </Label>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Campos das regras do grupo automático; todas as preenchidas precisam bater. */
export function RulesEditor({ draft, onChange, tags, disabled = false }: RulesEditorProps) {
  const set = (patch: Partial<RulesDraft>): void => onChange({ ...draft, ...patch })
  const tagNames = tags.map((tag) => tag.name)
  const options =
    draft.tag !== '' && !hasTag(tagNames, draft.tag) ? [...tagNames, draft.tag] : tagNames

  return (
    <div className="space-y-3">
      <Field label="Tag é" htmlFor="rule-tag">
        <Select
          value={draft.tag === '' ? ANY_TAG : draft.tag}
          disabled={disabled}
          onValueChange={(value) => set({ tag: value === ANY_TAG ? '' : value })}
        >
          <SelectTrigger id="rule-tag" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_TAG}>Qualquer</SelectItem>
            {options.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Nome contém" htmlFor="rule-name">
        <Input
          id="rule-name"
          value={draft.nameContains}
          maxLength={MAX_RULE_TEXT_LENGTH}
          disabled={disabled}
          placeholder="Ex.: Daily"
          onChange={(event) => set({ nameContains: event.target.value })}
        />
      </Field>
      <Field label="Aplicativo contém" htmlFor="rule-source">
        <Input
          id="rule-source"
          value={draft.sourceContains}
          maxLength={MAX_RULE_TEXT_LENGTH}
          disabled={disabled}
          placeholder="Ex.: Google Meet"
          onChange={(event) => set({ sourceContains: event.target.value })}
        />
      </Field>
      <Field label="Dias da semana">
        <div role="group" aria-label="Dias da semana" className="flex flex-wrap gap-1">
          {WEEKDAY_ORDER.map((day) => {
            const active = draft.weekdays.includes(day)
            return (
              <button
                key={day}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                className={cn(
                  'focus-visible:ring-ring/60 h-8 min-w-11 rounded-md border px-2 text-xs capitalize outline-none focus-visible:ring-2 disabled:opacity-50',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input text-muted-foreground hover:bg-accent'
                )}
                onClick={() =>
                  set({
                    weekdays: active
                      ? draft.weekdays.filter((item) => item !== day)
                      : [...draft.weekdays, day]
                  })
                }
              >
                {WEEKDAY_SHORT[day]}
              </button>
            )
          })}
        </div>
      </Field>
      <Field label="Início entre">
        <div className="flex items-center gap-2">
          <Input
            type="time"
            aria-label="Horário inicial"
            value={draft.startFrom}
            max={draft.startTo || undefined}
            disabled={disabled}
            className="w-32"
            onChange={(event) => set({ startFrom: event.target.value })}
          />
          <span className="text-muted-foreground text-xs">e</span>
          <Input
            type="time"
            aria-label="Horário final"
            value={draft.startTo}
            min={draft.startFrom || undefined}
            disabled={disabled}
            className="w-32"
            onChange={(event) => set({ startTo: event.target.value })}
          />
        </div>
      </Field>
      <Field label="Período">
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="Data inicial"
            value={draft.fromDate}
            max={draft.toDate || undefined}
            disabled={disabled}
            className="w-40"
            onChange={(event) => set({ fromDate: event.target.value })}
          />
          <span className="text-muted-foreground text-xs">até</span>
          <Input
            type="date"
            aria-label="Data final"
            value={draft.toDate}
            min={draft.fromDate || undefined}
            disabled={disabled}
            className="w-40"
            onChange={(event) => set({ toDate: event.target.value })}
          />
        </div>
      </Field>
    </div>
  )
}
