export const DATE_PRESETS = ['all', 'today', 'week', 'month', 'custom'] as const
export type DatePreset = (typeof DATE_PRESETS)[number]

export const DATE_PRESET_LABEL: Record<DatePreset, string> = {
  all: 'Qualquer data',
  today: 'Hoje',
  week: 'Últimos 7 dias',
  month: 'Últimos 30 dias',
  custom: 'Personalizado'
}

export interface DateFilter {
  preset: DatePreset
  /** `AAAA-MM-DD` (campo de data), só no personalizado; vazio = sem limite. */
  from: string
  to: string
}

export const NO_DATE_FILTER: DateFilter = { preset: 'all', from: '', to: '' }

export interface DateRange {
  /** Início (inclusive) e fim (exclusivo) em ms; `null` = sem limite. */
  fromMs: number | null
  toMs: number | null
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** `AAAA-MM-DD` como meia-noite local, ou `null` se não é uma data real. */
function parseDay(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)
  const valid =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  return valid ? date : null
}

/**
 * Intervalo do filtro, em dias do calendário local. "Últimos 7 dias" conta hoje e os 6
 * anteriores; no personalizado o dia final entra por inteiro, e datas invertidas se corrigem.
 */
export function dateRange(filter: DateFilter, now: Date): DateRange {
  const today = startOfDay(now)
  switch (filter.preset) {
    case 'all':
      return { fromMs: null, toMs: null }
    case 'today':
      return { fromMs: today.getTime(), toMs: addDays(today, 1).getTime() }
    case 'week':
      return { fromMs: addDays(today, -6).getTime(), toMs: addDays(today, 1).getTime() }
    case 'month':
      return { fromMs: addDays(today, -29).getTime(), toMs: addDays(today, 1).getTime() }
    case 'custom': {
      let from = parseDay(filter.from)
      let to = parseDay(filter.to)
      if (from && to && from.getTime() > to.getTime()) [from, to] = [to, from]
      return {
        fromMs: from ? from.getTime() : null,
        toMs: to ? addDays(to, 1).getTime() : null
      }
    }
  }
}
