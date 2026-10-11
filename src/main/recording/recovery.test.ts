import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MEETING_FILE,
  MEETING_FILES,
  MEETING_SCHEMA_VERSION,
  type MeetingFile,
  type MeetingStatus
} from '@shared/meeting'
import { readMeeting, writeMeeting } from '../meetings/repository'
import { createFakeMedia, FAKE_TOOLS } from './fake-media'
import { recoverInterrupted } from './recovery'

function meeting(status: MeetingStatus, overrides: Partial<MeetingFile> = {}): MeetingFile {
  return {
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: `id-${status}`,
    name: `Reunião ${status}`,
    createdAt: '2026-10-10T17:00:00.000Z',
    endedAt: null,
    durationMs: null,
    status,
    source: { kind: 'window', name: 'Janela' },
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
  root = await mkdtemp(join(tmpdir(), 'clearmeet-recovery-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function folderWith(
  name: string,
  status: MeetingStatus,
  files: Record<string, string> = {}
): Promise<string> {
  const folder = join(root, name)
  await mkdir(folder)
  await writeMeeting(folder, meeting(status))
  for (const [file, content] of Object.entries(files)) await writeFile(join(folder, file), content)
  return folder
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  )

const withTools = () => ({
  meetingsDir: root,
  getTools: () => Promise.resolve(FAKE_TOOLS),
  run: createFakeMedia({ durationSec: 90 }).run
})

describe('recoverInterrupted: Anotações', () => {
  it('a gravação interrompida é recuperada com as Anotações feitas ao vivo', async () => {
    const folder = join(root, 'crash-com-notas')
    await mkdir(folder)
    const notes = [
      { id: 'n1', offsetMs: 5000, text: 'Ponto 1', createdAt: '2026-10-10T17:01:00.000Z' },
      {
        id: 'n2',
        offsetMs: 61_000,
        text: 'Ponto 2\ncom linha',
        createdAt: '2026-10-10T17:02:00.000Z'
      }
    ]
    await writeMeeting(folder, meeting('recording', { notes }))
    await writeFile(join(folder, MEETING_FILES.videoPart), 'v')
    await writeFile(join(folder, MEETING_FILES.audioPart), 'a')

    const items = await recoverInterrupted(withTools())

    expect(items[0]?.outcome).toBe('recovered')
    const read = await readMeeting(folder)
    expect(read.ok && read.value.status).toBe('ready')
    expect(read.ok && read.value.notes).toEqual(notes)
  })
})

describe('recoverInterrupted', () => {
  it('recupera uma gravação interrompida a partir dos pedaços e marca como pronta', async () => {
    const folder = await folderWith('crash', 'recording', {
      [MEETING_FILES.videoPart]: 'v',
      [MEETING_FILES.audioPart]: 'a'
    })

    const items = await recoverInterrupted(withTools())

    expect(items).toEqual([
      {
        folder,
        name: 'Reunião recording',
        outcome: 'recovered',
        durationMs: 90_000,
        reason: null
      }
    ])
    const saved = await readMeeting(folder)
    expect(saved.ok && saved.value).toMatchObject({ status: 'ready', durationMs: 90_000 })
    expect(saved.ok && saved.value.endedAt).not.toBeNull()
    expect((await readdir(folder)).sort()).toEqual(['audio.opus', 'meeting.json', 'video.mp4'])
  })

  it('recupera também uma Reunião que caiu durante o pós-processamento', async () => {
    await folderWith('meio', 'processing', {
      [MEETING_FILES.audioPart]: 'a',
      [MEETING_FILES.video]: 'video ja pronto'
    })
    const items = await recoverInterrupted(withTools())
    expect(items[0]?.outcome).toBe('recovered')
  })

  it('Reunião só de áudio interrompida: recupera o áudio e fica sem vídeo', async () => {
    const folder = join(root, 'so-audio')
    await mkdir(folder)
    await writeMeeting(
      folder,
      meeting('recording', { source: { kind: 'none', name: null }, video: null })
    )
    await writeFile(join(folder, MEETING_FILES.audioPart), 'a')
    const [item] = await recoverInterrupted(withTools())
    expect(item?.outcome).toBe('recovered')
    const saved = await readMeeting(folder)
    expect(saved.ok && saved.value.video).toBeNull()
    expect(saved.ok && saved.value.audio).toEqual({ file: 'audio.opus' })
  })

  it('não mexe em Reuniões prontas, nem em pastas sem meeting.json ou com meeting.json inválido', async () => {
    const ready = await folderWith('pronta', 'ready', { 'audio.opus': 'a' })
    await mkdir(join(root, 'qualquer-pasta'))
    await writeFile(join(root, 'qualquer-pasta', 'arquivo.txt'), 'meu arquivo')
    const bad = join(root, 'invalida')
    await mkdir(bad)
    await writeFile(join(bad, MEETING_FILE), '{ nao eh json')
    await writeFile(join(bad, MEETING_FILES.audioPart), 'a')

    expect(await recoverInterrupted(withTools())).toEqual([])
    expect(await exists(join(ready, 'audio.opus'))).toBe(true)
    expect(await exists(join(root, 'qualquer-pasta', 'arquivo.txt'))).toBe(true)
    expect(await exists(join(bad, MEETING_FILES.audioPart))).toBe(true)
  })

  it('não toca na pasta da gravação em andamento', async () => {
    const active = await folderWith('ativa', 'recording', { [MEETING_FILES.audioPart]: 'a' })
    const items = await recoverInterrupted({ ...withTools(), skip: new Set([active]) })
    expect(items).toEqual([])
    expect(await exists(join(active, MEETING_FILES.audioPart))).toBe(true)
  })

  it('sem FFmpeg: fica pendente e os pedaços são preservados', async () => {
    const folder = await folderWith('pendente', 'recording', {
      [MEETING_FILES.videoPart]: 'v',
      [MEETING_FILES.audioPart]: 'a'
    })
    const items = await recoverInterrupted({
      meetingsDir: root,
      getTools: () => Promise.resolve(null)
    })
    expect(items[0]).toMatchObject({ outcome: 'pending' })
    expect((await readdir(folder)).sort()).toEqual([
      'audio.part.webm',
      'meeting.json',
      'video.part.mp4'
    ])
    const saved = await readMeeting(folder)
    expect(saved.ok && saved.value.status).toBe('recording')
  })

  it('falha no remux: status unprocessed e pedaços mantidos para tentar de novo', async () => {
    const folder = await folderWith('falha', 'recording', {
      [MEETING_FILES.audioPart]: 'a'
    })
    const items = await recoverInterrupted({
      ...withTools(),
      run: createFakeMedia({ failRemux: 'audio' }).run
    })
    expect(items[0]).toMatchObject({ outcome: 'failed' })
    expect(items[0]?.reason).toContain('Áudio da reunião')
    const saved = await readMeeting(folder)
    expect(saved.ok && saved.value.status).toBe('unprocessed')
    expect(await exists(join(folder, MEETING_FILES.audioPart))).toBe(true)

    // Na próxima abertura do app, com o FFmpeg funcionando, recupera.
    const again = await recoverInterrupted(withTools())
    expect(again[0]?.outcome).toBe('recovered')
  })

  it('gravação interrompida antes de gravar qualquer dado: descarta a pasta vazia', async () => {
    const folder = await folderWith('vazia', 'recording', {
      [MEETING_FILES.videoPart]: '',
      [MEETING_FILES.audioPart]: ''
    })
    const items = await recoverInterrupted(withTools())
    expect(items[0]).toMatchObject({ outcome: 'discarded', folder })
    expect(await exists(folder)).toBe(false)
  })

  it('nunca descarta uma pasta que tem outros arquivos do usuário', async () => {
    const folder = await folderWith('com-arquivo', 'recording', {
      [MEETING_FILES.audioPart]: '',
      'anotacoes.txt': 'importante'
    })
    await recoverInterrupted(withTools())
    expect(await exists(join(folder, 'anotacoes.txt'))).toBe(true)
  })

  it('várias Reuniões: cada uma tem o seu resultado', async () => {
    await folderWith('a', 'recording', { [MEETING_FILES.audioPart]: 'a' })
    await folderWith('b', 'ready', {})
    await folderWith('c', 'unprocessed', { [MEETING_FILES.audioPart]: 'a' })
    const items = await recoverInterrupted(withTools())
    expect(items.map((item) => item.outcome)).toEqual(['recovered', 'recovered'])
  })
})
