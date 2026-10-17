import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeetingListItem } from '@shared/library'
import { MEETING_SCHEMA_VERSION } from '@shared/meeting'
import { writeMeeting } from '../meetings/repository'
import { CleanupService } from './service'

vi.setConfig({ testTimeout: 20_000 })

const NOW = Date.parse('2026-10-16T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const VIDEO_BYTES = 1000
const AUDIO_BYTES = 100

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clearmeet-cleanup-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

interface Spec {
  name: string
  ageDays: number
  video?: boolean
  item?: Partial<MeetingListItem>
}

/** Cria a pasta de verdade e devolve o item que o índice mostraria. */
async function createMeeting(spec: Spec): Promise<MeetingListItem> {
  const folder = join(root, spec.name)
  const createdAt = new Date(NOW - spec.ageDays * DAY).toISOString()
  await mkdir(folder)
  await writeMeeting(folder, {
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: spec.name,
    name: spec.name,
    createdAt,
    endedAt: createdAt,
    durationMs: 60_000,
    status: 'ready',
    source: { kind: 'screen', name: null },
    quality: '1080p',
    video: { file: 'video.mp4', width: 1920, height: 1080, fps: 15 },
    audio: { file: 'audio.opus' },
    inputs: { mic: true, systemAudio: true },
    notes: [],
    issues: []
  })
  const hasVideo = spec.video !== false
  if (hasVideo) await writeFile(join(folder, 'video.mp4'), 'v'.repeat(VIDEO_BYTES))
  await writeFile(join(folder, 'audio.opus'), 'a'.repeat(AUDIO_BYTES))
  return {
    id: spec.name,
    folder,
    name: spec.name,
    createdAt,
    durationMs: 60_000,
    status: 'ready',
    live: false,
    source: { kind: 'screen', name: null },
    sizeBytes: 0,
    noteCount: 0,
    transcriptStatus: 'none',
    summaryStatus: 'none',
    hasVideo,
    compactionStatus: 'none',
    thumbnail: null,
    ...spec.item
  }
}

function setup(items: MeetingListItem[], options: { busy?: string[]; trashFails?: string[] } = {}) {
  const trashed: string[] = []
  const refreshed: string[] = []
  const service = new CleanupService({
    olderThan: (cutoffMs) =>
      Promise.resolve(items.filter((item) => Date.parse(item.createdAt) < cutoffMs)),
    meetingsDir: () => root,
    isBusy: (folder) => options.busy?.includes(folder) ?? false,
    trash: async (path) => {
      if (options.trashFails?.some((name) => path.includes(name))) throw new Error('em uso')
      trashed.push(path)
      await rm(path, { recursive: true, force: true })
    },
    refresh: (folder) => {
      refreshed.push(folder)
      return Promise.resolve()
    },
    now: () => NOW,
    log: () => undefined
  })
  return { service, trashed, refreshed }
}

describe('CleanupService.preview', () => {
  it('só entra o que é mais antigo que o período, e o espaço vem dos arquivos de verdade', async () => {
    const items = [
      await createMeeting({ name: 'velha', ageDays: 100 }),
      await createMeeting({ name: 'media', ageDays: 45 }),
      await createMeeting({ name: 'nova', ageDays: 10 })
    ]
    const { service } = setup(items)

    const days30 = await service.preview({ olderThanDays: 30, mode: 'video' })
    expect(days30).toEqual({
      ok: true,
      value: { count: 2, bytes: 2 * VIDEO_BYTES, skipped: 0, oldestDays: null }
    })
    const days60 = await service.preview({ olderThanDays: 60, mode: 'video' })
    expect(days60).toEqual({
      ok: true,
      value: { count: 1, bytes: VIDEO_BYTES, skipped: 0, oldestDays: null }
    })
    const days90 = await service.preview({ olderThanDays: 90, mode: 'video' })
    expect(days90).toMatchObject({ ok: true, value: { count: 1 } })
    const days200 = await service.preview({ olderThanDays: 200, mode: 'video' })
    expect(days200).toEqual({
      ok: true,
      value: { count: 0, bytes: 0, skipped: 0, oldestDays: 100 }
    })
  })

  it('Reunião inteira soma todos os arquivos da pasta (menos o temporário da Compactação)', async () => {
    const items = [await createMeeting({ name: 'velha', ageDays: 100 })]
    await writeFile(join(root, 'velha', 'transcript.json'), 'x'.repeat(50))
    await writeFile(join(root, 'velha', 'video.compacting.mp4'), 'x'.repeat(5000))
    const { service } = setup(items)

    const result = await service.preview({ olderThanDays: 30, mode: 'meeting' })
    expect(result).toMatchObject({ ok: true, value: { count: 1 } })
    const bytes = result.ok ? result.value.bytes : 0
    const meetingJson = await stat(join(root, 'velha', 'meeting.json'))
    expect(bytes).toBe(VIDEO_BYTES + AUDIO_BYTES + 50 + meetingJson.size)
  })

  it('Só vídeo ignora Reunião sem Vídeo no disco, mesmo que o índice diga que tem', async () => {
    const items = [
      await createMeeting({ name: 'sem-video', ageDays: 100, video: false }),
      await createMeeting({
        name: 'indice-velho',
        ageDays: 100,
        video: false,
        item: { hasVideo: true }
      })
    ]
    const { service } = setup(items)
    expect(await service.preview({ olderThanDays: 30, mode: 'video' })).toEqual({
      ok: true,
      value: { count: 0, bytes: 0, skipped: 0, oldestDays: 100 }
    })
  })

  it('Só vídeo ignora Reunião sem audio.opus (ficaria sem nada para tocar)', async () => {
    const items = [await createMeeting({ name: 'a', ageDays: 100 })]
    await rm(join(root, 'a', 'audio.opus'))
    const { service } = setup(items)
    expect(await service.preview({ olderThanDays: 30, mode: 'video' })).toMatchObject({
      ok: true,
      value: { count: 0 }
    })
  })

  it('Reuniões em uso (gravando, IA, Compactação, não prontas ou ocupadas no main) são puladas e contadas', async () => {
    const items = [
      await createMeeting({ name: 'ok', ageDays: 100 }),
      await createMeeting({ name: 'gravando', ageDays: 100, item: { live: true } }),
      await createMeeting({
        name: 'compactando',
        ageDays: 100,
        item: { compactionStatus: 'running' }
      }),
      await createMeeting({ name: 'pendente', ageDays: 100, item: { status: 'unprocessed' } }),
      await createMeeting({ name: 'conversa', ageDays: 100 })
    ]
    const { service } = setup(items, { busy: [join(root, 'conversa')] })
    expect(await service.preview({ olderThanDays: 30, mode: 'video' })).toEqual({
      ok: true,
      value: { count: 1, bytes: VIDEO_BYTES, skipped: 4, oldestDays: null }
    })
  })
})

describe('CleanupService.run', () => {
  it('Só vídeo: manda só o video.mp4 para a Lixeira e a Reunião segue com o áudio', async () => {
    const items = [
      await createMeeting({ name: 'velha', ageDays: 100 }),
      await createMeeting({ name: 'nova', ageDays: 5 })
    ]
    const { service, trashed, refreshed } = setup(items)

    const result = await service.run({ olderThanDays: 30, mode: 'video' })
    expect(result).toEqual({
      ok: true,
      value: { removed: 1, freedBytes: VIDEO_BYTES, skipped: 0, failed: 0 }
    })
    expect(trashed).toEqual([join(root, 'velha', 'video.mp4')])
    expect(refreshed).toEqual([join(root, 'velha')])
    expect((await readdir(join(root, 'velha'))).sort()).toEqual(['audio.opus', 'meeting.json'])
    expect(await readdir(join(root, 'nova'))).toContain('video.mp4')
  })

  it('Reunião inteira: a pasta vai para a Lixeira e o espaço liberado é o da pasta', async () => {
    const items = [await createMeeting({ name: 'velha', ageDays: 100 })]
    const { service, trashed } = setup(items)

    const result = await service.run({ olderThanDays: 30, mode: 'meeting' })
    expect(result.ok && result.value).toMatchObject({ removed: 1, skipped: 0, failed: 0 })
    expect(result.ok && result.value.freedBytes).toBeGreaterThan(VIDEO_BYTES + AUDIO_BYTES)
    expect(trashed).toEqual([join(root, 'velha')])
    expect(await readdir(root)).toEqual([])
  })

  it('pula as que estão em uso, informa quantas e não toca nelas', async () => {
    const items = [
      await createMeeting({ name: 'ok', ageDays: 100 }),
      await createMeeting({ name: 'gravando', ageDays: 100, item: { live: true } }),
      await createMeeting({ name: 'ia', ageDays: 100 })
    ]
    const { service } = setup(items, { busy: [join(root, 'ia')] })

    const result = await service.run({ olderThanDays: 30, mode: 'meeting' })
    expect(result.ok && result.value).toMatchObject({ removed: 1, skipped: 2, failed: 0 })
    expect((await readdir(root)).sort()).toEqual(['gravando', 'ia'])
  })

  it('arquivo em uso por outro programa: conta como falha e a Reunião fica intacta', async () => {
    const items = [
      await createMeeting({ name: 'presa', ageDays: 100 }),
      await createMeeting({ name: 'livre', ageDays: 100 })
    ]
    const { service } = setup(items, { trashFails: ['presa'] })

    const result = await service.run({ olderThanDays: 30, mode: 'video' })
    expect(result.ok && result.value).toMatchObject({ removed: 1, failed: 1 })
    expect(await readdir(join(root, 'presa'))).toContain('video.mp4')
    expect(await readdir(join(root, 'livre'))).not.toContain('video.mp4')
  })

  it('não executa duas Limpezas ao mesmo tempo', async () => {
    const items = [await createMeeting({ name: 'velha', ageDays: 100 })]
    const { service } = setup(items)
    const [first, second] = await Promise.all([
      service.run({ olderThanDays: 30, mode: 'video' }),
      service.run({ olderThanDays: 30, mode: 'video' })
    ])
    expect([first.ok, second.ok].sort()).toEqual([false, true])
  })
})
