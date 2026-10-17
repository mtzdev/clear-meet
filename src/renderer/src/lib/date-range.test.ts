import { describe, expect, it } from 'vitest'
import { dateRange, NO_DATE_FILTER, type DateFilter } from './date-range'

// 16/10/2026, 15:30 no horário local.
const NOW = new Date(2026, 9, 16, 15, 30)
const local = (month: number, day: number, hour = 0): number =>
  new Date(2026, month - 1, day, hour).getTime()

const filter = (overrides: Partial<DateFilter>): DateFilter => ({ ...NO_DATE_FILTER, ...overrides })

describe('dateRange', () => {
  it('"Qualquer data" não limita', () => {
    expect(dateRange(NO_DATE_FILTER, NOW)).toEqual({ fromMs: null, toMs: null })
  })

  it('"Hoje" vai da meia-noite à meia-noite seguinte', () => {
    expect(dateRange(filter({ preset: 'today' }), NOW)).toEqual({
      fromMs: local(10, 16),
      toMs: local(10, 17)
    })
  })

  it('"Últimos 7 dias" conta hoje e os 6 anteriores', () => {
    expect(dateRange(filter({ preset: 'week' }), NOW)).toEqual({
      fromMs: local(10, 10),
      toMs: local(10, 17)
    })
  })

  it('"Últimos 30 dias" atravessa a virada de mês', () => {
    expect(dateRange(filter({ preset: 'month' }), NOW)).toEqual({
      fromMs: local(9, 17),
      toMs: local(10, 17)
    })
  })

  it('personalizado inclui o dia final inteiro', () => {
    expect(
      dateRange(filter({ preset: 'custom', from: '2026-10-05', to: '2026-10-07' }), NOW)
    ).toEqual({ fromMs: local(10, 5), toMs: local(10, 8) })
  })

  it('personalizado aceita só um lado', () => {
    expect(dateRange(filter({ preset: 'custom', from: '2026-10-05' }), NOW)).toEqual({
      fromMs: local(10, 5),
      toMs: null
    })
    expect(dateRange(filter({ preset: 'custom', to: '2026-10-05' }), NOW)).toEqual({
      fromMs: null,
      toMs: local(10, 6)
    })
  })

  it('personalizado corrige datas invertidas e ignora datas inválidas', () => {
    expect(
      dateRange(filter({ preset: 'custom', from: '2026-10-09', to: '2026-10-03' }), NOW)
    ).toEqual({ fromMs: local(10, 3), toMs: local(10, 10) })
    expect(dateRange(filter({ preset: 'custom', from: '2026-02-31', to: 'ontem' }), NOW)).toEqual({
      fromMs: null,
      toMs: null
    })
  })

  it('o fim do mês vira o dia 1 do mês seguinte', () => {
    expect(
      dateRange(filter({ preset: 'custom', from: '2026-10-31', to: '2026-10-31' }), NOW)
    ).toEqual({
      fromMs: local(10, 31),
      toMs: local(11, 1)
    })
  })
})
