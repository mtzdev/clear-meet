import { describe, expect, it } from 'vitest'
import { parseProgressLine } from './run'

describe('parseProgressLine', () => {
  it('converte out_time_us (microssegundos) em milissegundos', () => {
    expect(parseProgressLine('out_time_us=1500000')).toBe(1500)
    expect(parseProgressLine('out_time_us=0\r')).toBe(0)
  })

  it('ignora as demais linhas do -progress', () => {
    for (const line of ['frame=120', 'progress=continue', 'out_time_us=N/A', 'out_time=00:00:01']) {
      expect(parseProgressLine(line)).toBeNull()
    }
  })
})
