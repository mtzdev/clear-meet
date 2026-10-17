import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MEETING_SCHEMA_VERSION, type MeetingFile } from '@shared/meeting'
import { scanFolder } from '../library/scan'
import { loadMeetingDetail } from './library'
import { readMeeting, writeMeeting } from './repository'
import { trashMeetingFolder, trashMeetingVideo, type TrashItem } from './trash'

let base: string
let root: string
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'clearmeet-trash-'))
  root = join(base, 'Reunioes')
  await mkdir(root)
})
afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

/** Lixeira de mentira: tira o item do lugar e guarda o caminho. */
function fakeTrash(): { trash: TrashItem; sent: string[] } {
  const sent: string[] = []
  return {
    sent,
    trash: async (path) => {
      sent.push(path)
      await rm(path, { recursive: true, force: true })
    }
  }
}

function meeting(name: string, overrides: Partial<MeetingFile> = {}): MeetingFile {
  return {
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: name,
    name,
    createdAt: '2026-08-10T17:30:00.000Z',
    endedAt: '2026-08-10T18:00:00.000Z',
    durationMs: 1_800_000,
    status: 'ready',
    source: { kind: 'screen', name: null },
    quality: '1080p',
    video: { file: 'video.mp4', width: 1920, height: 1080, fps: 15 },
    audio: { file: 'audio.opus' },
    inputs: { mic: true, systemAudio: true },
    notes: [{ id: 'n1', offsetMs: 1000, text: 'anotação', createdAt: '2026-08-10T17:31:00.000Z' }],
    issues: [],
    ...overrides
  }
}

async function createMeeting(
  name: string,
  options: { video?: boolean; audio?: boolean; meeting?: Partial<MeetingFile> } = {}
): Promise<string> {
  const folder = join(root, name)
  await mkdir(folder)
  await writeMeeting(folder, meeting(name, options.meeting))
  if (options.video !== false) await writeFile(join(folder, 'video.mp4'), 'v'.repeat(1000))
  if (options.audio !== false) await writeFile(join(folder, 'audio.opus'), 'a'.repeat(100))
  await writeFile(join(folder, 'transcript.json'), '{}')
  return folder
}

describe('trashMeetingFolder', () => {
  it('envia a pasta inteira para a Lixeira e preserva as outras Reuniões', async () => {
    const folder = await createMeeting('a')
    await createMeeting('b')
    const { trash, sent } = fakeTrash()
    expect(await trashMeetingFolder(root, folder, trash)).toEqual({ ok: true, value: null })
    expect(sent).toEqual([folder])
    expect(await readdir(root)).toEqual(['b'])
  })

  it('recusa caminho fora da pasta das Reuniões sem tocar em nada', async () => {
    const outside = join(base, 'fora')
    await mkdir(outside)
    await writeFile(join(outside, 'meeting.json'), '{}')
    const { trash, sent } = fakeTrash()
    const result = await trashMeetingFolder(root, join(root, '..', 'fora'), trash)
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(sent).toEqual([])
    expect(await readdir(outside)).toEqual(['meeting.json'])
  })

  it('pasta em uso: a Lixeira recusa, a Reunião continua inteira e o erro é curto', async () => {
    const folder = await createMeeting('a')
    const result = await trashMeetingFolder(root, folder, () => Promise.reject(new Error('em uso')))
    expect(result).toMatchObject({ ok: false, error: { code: 'busy' } })
    expect((await readdir(folder)).sort()).toEqual([
      'audio.opus',
      'meeting.json',
      'transcript.json',
      'video.mp4'
    ])
  })
})

describe('trashMeetingVideo', () => {
  it('manda só o video.mp4 para a Lixeira e informa o espaço liberado', async () => {
    const folder = await createMeeting('a')
    const { trash, sent } = fakeTrash()
    const result = await trashMeetingVideo(root, folder, trash)
    expect(result).toEqual({ ok: true, value: { freedBytes: 1000 } })
    expect(sent).toEqual([join(folder, 'video.mp4')])
    expect((await readdir(folder)).sort()).toEqual([
      'audio.opus',
      'meeting.json',
      'transcript.json'
    ])
  })

  it('a Reunião continua válida e navegável pelo Áudio da reunião', async () => {
    const folder = await createMeeting('a')
    await trashMeetingVideo(root, folder, fakeTrash().trash)

    const read = await readMeeting(folder)
    expect(read.ok && read.value.notes).toHaveLength(1)
    const detail = await loadMeetingDetail(root, folder, null)
    expect(detail).toMatchObject({
      ok: true,
      value: { hasVideoFile: false, hasAudioFile: true, status: 'ready' }
    })
    const scan = await scanFolder(folder)
    expect(scan?.videoSig).toBeNull()
    expect(scan?.files.has('audio.opus')).toBe(true)
  })

  it('Reunião sem Vídeo não tem o que apagar', async () => {
    const folder = await createMeeting('a', { video: false })
    const { trash, sent } = fakeTrash()
    expect(await trashMeetingVideo(root, folder, trash)).toMatchObject({
      ok: false,
      error: { code: 'not-found' }
    })
    expect(sent).toEqual([])
  })

  it('sem áudio a Reunião ficaria sem nada para tocar: recusa', async () => {
    const folder = await createMeeting('a', { audio: false })
    const { trash, sent } = fakeTrash()
    expect(await trashMeetingVideo(root, folder, trash)).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })
    expect(sent).toEqual([])
  })

  it('Reunião que não está pronta não é mexida', async () => {
    const folder = await createMeeting('a', { meeting: { status: 'unprocessed' } })
    const { trash, sent } = fakeTrash()
    expect(await trashMeetingVideo(root, folder, trash)).toMatchObject({
      ok: false,
      error: { code: 'busy' }
    })
    expect(sent).toEqual([])
  })

  it('Vídeo em uso: a Lixeira recusa e o arquivo fica', async () => {
    const folder = await createMeeting('a')
    const result = await trashMeetingVideo(root, folder, () => Promise.reject(new Error('em uso')))
    expect(result).toMatchObject({ ok: false, error: { code: 'busy' } })
    expect(await readdir(folder)).toContain('video.mp4')
  })

  it('recusa caminho fora da pasta das Reuniões', async () => {
    const { trash, sent } = fakeTrash()
    const result = await trashMeetingVideo(root, join(root, '..'), trash)
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(sent).toEqual([])
  })
})
