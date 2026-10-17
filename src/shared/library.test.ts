import { describe, expect, it } from 'vitest'
import { listStatus, lockFor, type MeetingListItem } from './library'

type StatusInput = Pick<MeetingListItem, 'status' | 'live' | 'transcriptStatus' | 'summaryStatus'>

function input(overrides: Partial<StatusInput> = {}): StatusInput {
  return {
    status: 'ready',
    live: false,
    transcriptStatus: 'none',
    summaryStatus: 'none',
    ...overrides
  }
}

describe('listStatus', () => {
  it('Reunião pronta sem IA em andamento é "Pronta"', () => {
    expect(listStatus(input())).toEqual({ kind: 'ready', label: 'Pronta' })
    expect(listStatus(input({ transcriptStatus: 'ready', summaryStatus: 'ready' })).kind).toBe(
      'ready'
    )
  })

  it('a gravação ao vivo vence qualquer outro estado', () => {
    expect(listStatus(input({ live: true, status: 'recording' }))).toEqual({
      kind: 'recording',
      label: 'Gravando agora'
    })
  })

  it('gravação sem app gravando é interrompida', () => {
    expect(listStatus(input({ status: 'recording' })).kind).toBe('interrupted')
  })

  it('pós-processamento e arquivos pendentes são "processando"', () => {
    expect(listStatus(input({ status: 'processing' }))).toEqual({
      kind: 'processing',
      label: 'Processando'
    })
    expect(listStatus(input({ status: 'unprocessed' })).kind).toBe('processing')
  })

  it('mostra a IA em andamento: Transcrição antes do Resumo', () => {
    expect(listStatus(input({ transcriptStatus: 'running', summaryStatus: 'running' })).kind).toBe(
      'transcribing'
    )
    expect(listStatus(input({ transcriptStatus: 'ready', summaryStatus: 'running' }))).toEqual({
      kind: 'summarizing',
      label: 'Resumindo'
    })
  })

  it('avisa quando a Transcrição ou o Resumo foram interrompidos', () => {
    expect(listStatus(input({ transcriptStatus: 'error' })).kind).toBe('warning')
    expect(listStatus(input({ transcriptStatus: 'ready', summaryStatus: 'error' })).kind).toBe(
      'warning'
    )
  })
})

describe('lockFor', () => {
  it('só Reuniões prontas e fora de gravação são editáveis', () => {
    expect(lockFor('ready', false)).toBeNull()
    expect(lockFor('ready', true)).toBe('recording')
    expect(lockFor('recording', false)).toBe('recording')
    expect(lockFor('processing', false)).toBe('unfinished')
    expect(lockFor('unprocessed', false)).toBe('unfinished')
  })
})
