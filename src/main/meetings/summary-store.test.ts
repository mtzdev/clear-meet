import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SUMMARY_FILE, SUMMARY_SCHEMA_VERSION, type SummaryFile } from '@shared/summary'
import { tempMeetings, type TempMeetings } from '../ai/testing'
import { addMeetingNote } from './notes-store'
import { readMeeting } from './repository'
import { readSummary, removeSummary, updateSummaryMeta, writeSummary } from './summary-store'

let dir: TempMeetings
beforeEach(async () => {
  dir = await tempMeetings()
})
afterEach(async () => {
  await dir.cleanup()
})

const summary: SummaryFile = {
  schemaVersion: SUMMARY_SCHEMA_VERSION,
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  createdAt: '2026-10-13T13:00:00.000Z',
  overview: 'Visão geral.',
  keyPoints: [{ text: 'Ponto', at: [5000] }],
  decisions: [],
  actions: [{ owner: null, task: 'Fazer', due: null, at: [] }]
}

describe('summary-store', () => {
  it('sem summary.json não há Resumo', async () => {
    expect(await readSummary(dir.folder)).toEqual({ ok: true, value: null })
  })

  it('grava e relê o Resumo com a versão do schema, o provedor e o modelo', async () => {
    await writeSummary(dir.folder, summary)
    expect(await readSummary(dir.folder)).toEqual({ ok: true, value: summary })
    const text = await readFile(join(dir.folder, SUMMARY_FILE), 'utf8')
    expect(JSON.parse(text)).toMatchObject({
      schemaVersion: 1,
      provider: 'groq',
      model: summary.model
    })
  })

  it('um summary.json inválido é erro de leitura, não Resumo vazio', async () => {
    await writeSummary(dir.folder, { ...summary, schemaVersion: 9 as never })
    expect(await readSummary(dir.folder)).toMatchObject({ ok: false })
  })

  it('remove o arquivo', async () => {
    await writeSummary(dir.folder, summary)
    await removeSummary(dir.folder)
    expect(await readSummary(dir.folder)).toEqual({ ok: true, value: null })
  })

  it('updateSummaryMeta altera só o bloco do Resumo, sem perder Anotações nem a Transcrição', async () => {
    await addMeetingNote(dir.root, dir.folder, { offsetMs: 1000, text: 'nota' })
    await updateSummaryMeta(dir.folder, () => ({
      status: 'running',
      updatedAt: '2026-10-13T13:00:00.000Z'
    }))
    const read = await readMeeting(dir.folder)
    expect(read.ok && read.value.summary).toEqual({
      status: 'running',
      updatedAt: '2026-10-13T13:00:00.000Z'
    })
    expect(read.ok && read.value.notes).toHaveLength(1)
    expect(read.ok && read.value.transcript?.status).toBe('ready')

    await updateSummaryMeta(dir.folder, () => undefined)
    const cleared = await readMeeting(dir.folder)
    expect(cleared.ok && cleared.value.summary).toBeUndefined()
  })
})
