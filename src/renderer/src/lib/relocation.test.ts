import { describe, expect, it } from 'vitest'
import type { RelocationSummary } from '@shared/relocation'
import { describeRelocation, moveQuestion, relocationPercent } from './relocation'

const base: RelocationSummary = {
  previousDir: 'C:\\Antiga',
  newDir: 'D:\\Nova',
  moveRequested: true,
  total: 3,
  moved: 3,
  issues: [],
  notAttempted: 0,
  leftovers: 0
}

describe('moveQuestion', () => {
  it('usa singular e plural e o tamanho legível', () => {
    expect(moveQuestion(1, 1536)).toBe('Mover 1 Reunião (1,5 KB) para a nova pasta?')
    expect(moveQuestion(12, 3 * 1024 ** 3)).toBe('Mover 12 Reuniões (3,0 GB) para a nova pasta?')
  })
})

describe('relocationPercent', () => {
  it('vem dos bytes e nunca passa de 100', () => {
    const progress = { current: 1, total: 2, name: 'a', bytesDone: 50, bytesTotal: 200 }
    expect(relocationPercent(progress)).toBe(25)
    expect(relocationPercent({ ...progress, bytesDone: 500 })).toBe(100)
  })

  it('sem bytes (pastas vazias), usa a contagem de Reuniões', () => {
    expect(
      relocationPercent({ current: 2, total: 4, name: 'a', bytesDone: 0, bytesTotal: 0 })
    ).toBe(25)
  })
})

describe('describeRelocation', () => {
  it('tudo movido: título com a contagem e sem botão da pasta antiga', () => {
    const report = describeRelocation(base)
    expect(report.title).toBe('3 Reuniões movidas')
    expect(report.lines).toEqual(['O ClearMeet agora usa D:\\Nova.'])
    expect(report.showPreviousDir).toBe(false)
  })

  it('uma só Reunião movida usa o singular', () => {
    expect(describeRelocation({ ...base, total: 1, moved: 1 }).title).toBe('1 Reunião movida')
  })

  it('sobras na pasta antiga: avisa e oferece abrir a pasta', () => {
    const report = describeRelocation({ ...base, leftovers: 1 })
    expect(report.showPreviousDir).toBe(true)
    expect(report.lines.join(' ')).toContain('estavam em uso')
  })

  it('só trocar a pasta: explica que as antigas ficaram para trás', () => {
    const report = describeRelocation({ ...base, moveRequested: false, total: 0, moved: 0 })
    expect(report.title).toBe('Pasta trocada')
    expect(report.showPreviousDir).toBe(true)
    expect(report.lines[1]).toContain('continuam na pasta anterior')
  })

  it('sem Reuniões para mover: troca simples', () => {
    const report = describeRelocation({ ...base, total: 0, moved: 0 })
    expect(report).toEqual({
      title: 'Pasta trocada',
      lines: ['O ClearMeet agora usa D:\\Nova.'],
      showPreviousDir: false
    })
  })

  it('falhas: conta as que ficaram, lista os motivos e limita a lista', () => {
    const issues = Array.from({ length: 7 }, (_, index) => ({
      name: `reuniao-${index}`,
      reason: index === 0 ? ('exists' as const) : ('in-use' as const)
    }))
    const report = describeRelocation({ ...base, total: 8, moved: 1, issues })
    expect(report.title).toBe('Nem todas as Reuniões foram movidas')
    expect(report.showPreviousDir).toBe(true)
    expect(report.lines[0]).toContain('1 de 8 foram movidas. 7 Reuniões ficaram')
    expect(report.lines).toContain('reuniao-0: já existe uma pasta com esse nome no destino.')
    expect(report.lines).toContain('E mais 2.')
    expect(report.lines.filter((line) => line.startsWith('reuniao-'))).toHaveLength(5)
  })

  it('interrompida pelo usuário: conta as não tentadas', () => {
    const report = describeRelocation({ ...base, total: 3, moved: 1, notAttempted: 2 })
    expect(report.lines[0]).toContain('1 de 3 foram movidas. 2 Reuniões ficaram')
    expect(report.lines).toContain('Você interrompeu a troca antes do fim.')
  })

  it('uma só ficou para trás: verbo no singular', () => {
    const report = describeRelocation({
      ...base,
      total: 2,
      moved: 1,
      issues: [{ name: 'a', reason: 'failed' }]
    })
    expect(report.lines[0]).toContain('1 Reunião ficou na pasta anterior')
  })
})
