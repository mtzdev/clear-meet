import { describe, expect, it } from 'vitest'
import { listBlock, listStatus, lockFor, type MeetingListItem } from './library'

type StatusInput = Pick<
  MeetingListItem,
  'status' | 'live' | 'transcriptStatus' | 'summaryStatus' | 'compactionStatus'
>

function input(overrides: Partial<StatusInput> = {}): StatusInput {
  return {
    status: 'ready',
    live: false,
    transcriptStatus: 'none',
    summaryStatus: 'none',
    compactionStatus: 'none',
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

  it('mostra "Compactando…" depois da IA e "Falha ao compactar" no fim', () => {
    expect(listStatus(input({ compactionStatus: 'running' }))).toEqual({
      kind: 'compacting',
      label: 'Compactando…'
    })
    expect(
      listStatus(input({ compactionStatus: 'running', transcriptStatus: 'running' })).kind
    ).toBe('transcribing')
    expect(listStatus(input({ compactionStatus: 'error' }))).toEqual({
      kind: 'warning',
      label: 'Falha ao compactar'
    })
    expect(listStatus(input({ compactionStatus: 'done' })).kind).toBe('ready')
    expect(listStatus(input({ compactionStatus: 'kept-original' })).kind).toBe('ready')
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

describe('listBlock', () => {
  it('Reunião pronta e parada pode ser renomeada e excluída', () => {
    expect(listBlock(input(), 'rename')).toBeNull()
    expect(listBlock(input(), 'delete')).toBeNull()
  })

  it('gravando agora bloqueia as duas ações', () => {
    expect(listBlock(input({ live: true }), 'rename')).toBe('recording')
    expect(listBlock(input({ live: true }), 'delete')).toBe('recording')
  })

  it('Transcrição ou Resumo em andamento bloqueiam as duas ações', () => {
    for (const action of ['rename', 'delete'] as const) {
      expect(listBlock(input({ transcriptStatus: 'running' }), action)).toBe('transcribing')
      expect(listBlock(input({ summaryStatus: 'running' }), action)).toBe('summarizing')
    }
  })

  it('renomear segue o bloqueio de edição; excluir libera interrompida e arquivos pendentes', () => {
    expect(listBlock(input({ status: 'recording' }), 'rename')).toBe('recording')
    expect(listBlock(input({ status: 'unprocessed' }), 'rename')).toBe('unfinished')
    expect(listBlock(input({ status: 'processing' }), 'rename')).toBe('unfinished')
    expect(listBlock(input({ status: 'recording' }), 'delete')).toBeNull()
    expect(listBlock(input({ status: 'unprocessed' }), 'delete')).toBeNull()
    expect(listBlock(input({ status: 'processing' }), 'delete')).toBe('unfinished')
  })

  it('Compactação em andamento bloqueia renomear, excluir e apagar só o vídeo', () => {
    const compacting = input({ compactionStatus: 'running' })
    for (const action of ['rename', 'delete', 'delete-video'] as const) {
      expect(listBlock(compacting, action)).toBe('compacting')
    }
  })

  it('Tags só esperam a gravação e o pós-processamento, não a IA nem a Compactação', () => {
    expect(listBlock(input(), 'tag')).toBeNull()
    expect(
      listBlock(input({ transcriptStatus: 'running', compactionStatus: 'running' }), 'tag')
    ).toBeNull()
    expect(listBlock(input({ live: true }), 'tag')).toBe('recording')
    expect(listBlock(input({ status: 'recording' }), 'tag')).toBe('recording')
    expect(listBlock(input({ status: 'processing' }), 'tag')).toBe('unfinished')
  })

  it('apagar só o vídeo exige Reunião pronta, mas não espera a IA', () => {
    expect(listBlock(input(), 'delete-video')).toBeNull()
    expect(listBlock(input({ live: true }), 'delete-video')).toBe('recording')
    expect(listBlock(input({ status: 'recording' }), 'delete-video')).toBe('recording')
    expect(listBlock(input({ status: 'unprocessed' }), 'delete-video')).toBe('unfinished')
    expect(listBlock(input({ transcriptStatus: 'running' }), 'delete-video')).toBeNull()
    expect(listBlock(input({ summaryStatus: 'running' }), 'delete-video')).toBeNull()
  })

  it('erro de IA não bloqueia', () => {
    const failed = input({ transcriptStatus: 'error', summaryStatus: 'error' })
    expect(listBlock(failed, 'rename')).toBeNull()
    expect(listBlock(failed, 'delete')).toBeNull()
  })
})
