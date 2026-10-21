import { LoaderCircle, MousePointerClick, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { RulesEditor } from '@/components/groups/rules-editor'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { draftToRules, rulesToDraft, type RulesDraft } from '@/lib/group-rules-draft'
import { meetingCountText } from '@/lib/groups'
import { settle, useTags } from '@/lib/tags'
import { cn } from '@/lib/utils'
import {
  MAX_GROUP_DESCRIPTION_LENGTH,
  MAX_GROUP_NAME_LENGTH,
  rulesProblem,
  type GroupInfo,
  type GroupRules
} from '@shared/groups'

const PREVIEW_DEBOUNCE_MS = 300

type Mode = 'manual' | 'auto'

interface GroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Grupo em edição; ausente = grupo novo. */
  group?: GroupInfo | null
  /** Valores iniciais de um grupo novo (por exemplo, o de uma sugestão). */
  initial?: { name: string; rules: GroupRules | null }
  onSaved?: (group: GroupInfo) => void
}

interface Preview {
  key: string
  matching: number
}

const MODES: { mode: Mode; title: string; hint: string; icon: typeof Zap }[] = [
  {
    mode: 'manual',
    title: 'Manual',
    hint: 'Você escolhe quais Reuniões entram.',
    icon: MousePointerClick
  },
  {
    mode: 'auto',
    title: 'Automático',
    hint: 'Reuniões novas entram sozinhas quando combinam com as regras.',
    icon: Zap
  }
]

interface GroupFormProps {
  group: GroupInfo | null
  initial: GroupDialogProps['initial']
  saving: boolean
  setSaving: (saving: boolean) => void
  onSaved?: (group: GroupInfo) => void
  onClose: () => void
}

function GroupForm({ group, initial, saving, setSaving, onSaved, onClose }: GroupFormProps) {
  const { tags } = useTags()
  const initialRules = group ? group.rules : (initial?.rules ?? null)
  const [name, setName] = useState(group?.name ?? initial?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [mode, setMode] = useState<Mode>(initialRules ? 'auto' : 'manual')
  const [draft, setDraft] = useState<RulesDraft>(() => rulesToDraft(initialRules))
  const [applyNow, setApplyNow] = useState(true)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)

  const rules = mode === 'auto' ? draftToRules(draft) : null
  const problem = rules ? rulesProblem(rules) : null
  const previewKey = rules && !problem ? JSON.stringify(rules) : null

  useEffect(() => {
    if (previewKey === null || rules === null) return
    const request = ++latest.current
    const timer = setTimeout(() => {
      window.api.invoke('groups:preview', { id: group?.id ?? null, rules }).then(
        (result) => {
          if (request === latest.current) setPreview({ key: previewKey, matching: result.matching })
        },
        () => undefined
      )
    }, PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `rules` e `group` mudam junto com a chave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey])

  const matching = preview !== null && preview.key === previewKey ? preview.matching : null
  const editing = group !== null

  const save = async (): Promise<void> => {
    if (saving) return
    if (mode === 'auto' && rules === null) {
      setError('Defina ao menos uma regra para o grupo automático.')
      return
    }
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    const input = { name, description, rules }
    const apply = mode === 'auto' && applyNow && (matching ?? 0) > 0
    const result = await settle(
      group
        ? window.api.invoke('groups:update', { ...input, id: group.id, applyNow: apply })
        : window.api.invoke('groups:create', { ...input, applyNow: apply })
    )
    setSaving(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onSaved?.(result.value.group)
    onClose()
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{editing ? 'Editar grupo' : 'Novo grupo'}</AlertDialogTitle>
        <AlertDialogDescription>
          Uma Reunião fica em um grupo só. Escolher outro grupo para ela troca o que ela tinha.
        </AlertDialogDescription>
      </AlertDialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="group-name">Nome</Label>
          <Input
            id="group-name"
            value={name}
            autoFocus
            maxLength={MAX_GROUP_NAME_LENGTH}
            placeholder="Ex.: Daily do time"
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void save()
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="group-description">Descrição (opcional)</Label>
          <Textarea
            id="group-description"
            value={description}
            rows={2}
            maxLength={MAX_GROUP_DESCRIPTION_LENGTH}
            disabled={saving}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div role="radiogroup" aria-label="Tipo do grupo" className="grid grid-cols-2 gap-2">
          {MODES.map(({ mode: option, title, hint, icon: Icon }) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              disabled={saving}
              className={cn(
                'focus-visible:ring-ring/60 flex flex-col items-start gap-1 rounded-lg border p-3 text-left outline-none focus-visible:ring-2 disabled:opacity-50',
                mode === option ? 'border-primary bg-accent/50' : 'border-border hover:bg-accent/30'
              )}
              onClick={() => {
                setMode(option)
                setError(null)
              }}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Icon className="size-3.5" aria-hidden />
                {title}
              </span>
              <span className="text-muted-foreground text-xs leading-snug">{hint}</span>
            </button>
          ))}
        </div>

        {mode === 'auto' && (
          <div className="border-border space-y-3 rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">
              A Reunião entra quando todas as regras preenchidas combinam. Só entram Reuniões sem
              grupo; quem você colocou em um grupo à mão nunca é tirado dele.
            </p>
            <RulesEditor draft={draft} onChange={setDraft} tags={tags ?? []} disabled={saving} />
            {problem && (
              <p role="alert" className="text-destructive text-xs">
                {problem}
              </p>
            )}
            {rules !== null && !problem && (
              <div className="space-y-2" aria-live="polite">
                <p className="text-sm">
                  {matching === null
                    ? 'Conferindo as Reuniões…'
                    : matching === 0
                      ? 'Nenhuma Reunião sem grupo combina agora.'
                      : `${matching === 1 ? '1 Reunião sem grupo combina' : `${matching} Reuniões sem grupo combinam`}.`}
                </p>
                {matching !== null && matching > 0 && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={applyNow}
                      disabled={saving}
                      className="accent-primary size-4"
                      onChange={(event) => setApplyNow(event.target.checked)}
                    />
                    Aplicar às {meetingCountText(matching)} sem grupo que combinam
                  </label>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
        <Button disabled={saving || name.trim() === ''} onClick={() => void save()}>
          {saving && <LoaderCircle className="animate-spin" aria-hidden />}
          {editing ? 'Salvar' : 'Criar grupo'}
        </Button>
      </AlertDialogFooter>
    </>
  )
}

/** Criar ou editar um grupo: nome, descrição, e se é manual ou automático (com as regras). */
export function GroupDialog({
  open,
  onOpenChange,
  group = null,
  initial,
  onSaved
}: GroupDialogProps) {
  const [saving, setSaving] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={(next) => (saving ? undefined : onOpenChange(next))}>
      <AlertDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <GroupForm
          group={group}
          initial={initial}
          saving={saving}
          setSaving={setSaving}
          {...(onSaved ? { onSaved } : {})}
          onClose={() => onOpenChange(false)}
        />
      </AlertDialogContent>
    </AlertDialog>
  )
}
