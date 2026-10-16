import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MEETING_FILE,
  MEETING_SCHEMA_VERSION,
  type MeetingFile,
  type MeetingNote
} from '@shared/meeting'
import { findMeetingFolder, listMeetings, loadMeetingDetail } from './library'
import { writeMeeting } from './repository'

function note(id: string, offsetMs: number): MeetingNote {
  return { id, offsetMs, text: `nota ${id}`, createdAt: '2026-10-10T10:00:00.000Z' }
}

function meeting(overrides: Partial<MeetingFile> = {}): MeetingFile {
  return {
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: 'id-1',
    name: 'Reunião',
    createdAt: '2026-10-10T17:30:00.000Z',
    endedAt: '2026-10-10T18:00:00.000Z',
    durationMs: 1_800_000,
    status: 'ready',
    source: { kind: 'window', name: 'Zoom' },
    quality: '1080p',
    video: { file: 'video.mp4', width: 1920, height: 1080, fps: 15 },
    audio: { file: 'audio.opus' },
    inputs: { mic: true, systemAudio: true },
    notes: [],
    issues: [],
    ...overrides
  }
}

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clearmeet-library-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function create(
  folderName: string,
  overrides: Partial<MeetingFile> = {},
  files: string[] = []
): Promise<string> {
  const folder = join(root, folderName)
  await mkdir(folder)
  await writeMeeting(folder, meeting(overrides))
  for (const file of files) await writeFile(join(folder, file), 'x')
  return folder
}

describe('listMeetings', () => {
  it('lista as Reuniões válidas, mais recentes primeiro, com os dados da lista', async () => {
    await create('antiga', { id: 'a', name: 'Antiga', createdAt: '2026-10-01T10:00:00.000Z' })
    await create('nova', {
      id: 'n',
      name: 'Nova',
      createdAt: '2026-10-12T10:00:00.000Z',
      source: { kind: 'none', name: null },
      video: null,
      notes: [note('1', 1000), note('2', 2000)]
    })
    const meio = await create('meio', {
      id: 'm',
      name: 'Meio',
      createdAt: '2026-10-05T10:00:00.000Z',
      durationMs: null,
      status: 'recording'
    })

    const list = await listMeetings(root, meio)
    expect(list.skipped).toBe(0)
    expect(list.items.map((item) => item.id)).toEqual(['n', 'm', 'a'])
    expect(list.items[0]).toMatchObject({
      name: 'Nova',
      durationMs: 1_800_000,
      status: 'ready',
      live: false,
      source: { kind: 'none', name: null },
      noteCount: 2,
      folder: join(root, 'nova')
    })
    // A Reunião em gravação aparece, marcada como `live`, sem duração.
    expect(list.items[1]).toMatchObject({ live: true, status: 'recording', durationMs: null })
  })

  it('ignora o que não é Reunião e conta os meeting.json inválidos, sem alterá-los', async () => {
    await create('boa', { id: 'ok' })
    await mkdir(join(root, 'sem-json'))
    await writeFile(join(root, 'solto.txt'), 'x')
    await mkdir(join(root, 'quebrada'))
    await writeFile(join(root, 'quebrada', MEETING_FILE), '{ "schemaVersion": 1, ')
    await mkdir(join(root, 'futura'))
    const future = JSON.stringify({ schemaVersion: 99, id: 'f' })
    await writeFile(join(root, 'futura', MEETING_FILE), future)

    const list = await listMeetings(root, null)
    expect(list.items.map((item) => item.id)).toEqual(['ok'])
    expect(list.skipped).toBe(2)
    expect(await readFile(join(root, 'futura', MEETING_FILE), 'utf8')).toBe(future)
  })

  it('pasta das Reuniões inexistente ou vazia = lista vazia', async () => {
    expect(await listMeetings(join(root, 'nao-existe'), null)).toEqual({ items: [], skipped: 0 })
    expect(await listMeetings(root, null)).toEqual({ items: [], skipped: 0 })
  })

  it('a pasta ativa casa mesmo com caixa diferente no Windows', async () => {
    const folder = await create('Ativa', { id: 'x', status: 'recording', durationMs: null })
    const list = await listMeetings(
      root,
      process.platform === 'win32' ? folder.toLowerCase() : folder
    )
    expect(list.items[0]?.live).toBe(true)
  })
})

describe('findMeetingFolder', () => {
  it('acha a pasta pelo id, mesmo com outro nome de pasta', async () => {
    await create('qualquer nome', { id: 'procurado' })
    await create('outra', { id: 'outro' })
    expect(await findMeetingFolder(root, 'procurado')).toBe(join(root, 'qualquer nome'))
    expect(await findMeetingFolder(root, 'nao-existe')).toBeNull()
  })
})

describe('loadMeetingDetail', () => {
  it('devolve a Reunião com Anotações ordenadas, arquivos presentes e proporção do Vídeo', async () => {
    const folder = await create('detalhe', { notes: [note('b', 5000), note('a', 1000)] }, [
      'video.mp4',
      'audio.opus'
    ])
    const result = await loadMeetingDetail(root, folder, null)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      id: 'id-1',
      folderName: 'detalhe',
      hasVideoFile: true,
      hasAudioFile: true,
      lock: null
    })
    expect(result.value.videoAspect).toBeCloseTo(16 / 9)
    expect(result.value.notes.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('o estado do Resumo aparece no detalhe e na lista ("Resumindo…")', async () => {
    const summary = {
      status: 'running' as const,
      updatedAt: '2026-10-13T13:00:00.000Z'
    }
    const folder = await create('resumindo', { summary })
    await create('sem-resumo', { id: 'outro', createdAt: '2026-10-09T10:00:00.000Z' })

    const detail = await loadMeetingDetail(root, folder, null)
    expect(detail.ok && detail.value.summary).toEqual({
      status: 'running',
      error: null,
      provider: null,
      model: null,
      updatedAt: '2026-10-13T13:00:00.000Z'
    })
    const list = await listMeetings(root, null)
    expect(list.items.map((item) => [item.id, item.summaryStatus])).toEqual([
      ['id-1', 'running'],
      ['outro', 'none']
    ])
  })

  it('sem video.mp4 no disco (ou Reunião só de áudio) só há o Áudio da reunião', async () => {
    const folder = await create('so-audio', { video: null, source: { kind: 'none', name: null } }, [
      'audio.opus'
    ])
    const result = await loadMeetingDetail(root, folder, null)
    expect(result.ok && result.value).toMatchObject({
      hasVideoFile: false,
      hasAudioFile: true,
      videoAspect: null
    })
  })

  it('bloqueia a edição de Reunião em gravação, interrompida ou ainda sem arquivos finais', async () => {
    const recording = await create('gravando', { status: 'recording', durationMs: null })
    const live = await loadMeetingDetail(root, recording, recording)
    expect(live.ok && live.value.lock).toBe('recording')
    const interrupted = await loadMeetingDetail(root, recording, null)
    expect(interrupted.ok && interrupted.value.lock).toBe('recording')

    const pending = await create('pendente', { id: 'p', status: 'unprocessed' })
    const unfinished = await loadMeetingDetail(root, pending, null)
    expect(unfinished.ok && unfinished.value.lock).toBe('unfinished')
  })

  it('erros: fora da pasta das Reuniões, sem meeting.json, meeting.json inválido', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'clearmeet-fora-'))
    try {
      const out = await loadMeetingDetail(root, outside, null)
      expect(!out.ok && out.error.code).toBe('invalid-request')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
    await mkdir(join(root, 'vazia'))
    const missing = await loadMeetingDetail(root, join(root, 'vazia'), null)
    expect(!missing.ok && missing.error.code).toBe('not-found')

    await mkdir(join(root, 'quebrada'))
    await writeFile(join(root, 'quebrada', MEETING_FILE), 'não é json')
    const broken = await loadMeetingDetail(root, join(root, 'quebrada'), null)
    expect(!broken.ok && broken.error.code).toBe('invalid-request')
  })
})
