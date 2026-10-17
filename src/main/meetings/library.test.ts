import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MEETING_FILE,
  MEETING_SCHEMA_VERSION,
  type MeetingFile,
  type MeetingNote
} from '@shared/meeting'
import { findMeetingFolder, loadMeetingDetail } from './library'
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
      hasAudioInput: true,
      lock: null
    })
    expect(result.value.videoAspect).toBeCloseTo(16 / 9)
    expect(result.value.notes.map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('o estado do Resumo aparece no detalhe', async () => {
    const summary = {
      status: 'running' as const,
      updatedAt: '2026-10-13T13:00:00.000Z'
    }
    const folder = await create('resumindo', { summary })

    const detail = await loadMeetingDetail(root, folder, null)
    expect(detail.ok && detail.value.summary).toEqual({
      status: 'running',
      error: null,
      provider: null,
      model: null,
      updatedAt: '2026-10-13T13:00:00.000Z'
    })
  })

  it('Reunião sem microfone nem áudio do sistema é marcada como sem entrada de áudio', async () => {
    const folder = await create('mudo', { inputs: { mic: false, systemAudio: false } }, [
      'audio.opus'
    ])
    const result = await loadMeetingDetail(root, folder, null)
    expect(result.ok && result.value.hasAudioInput).toBe(false)
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
