import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MEETING_FILE, MEETING_SCHEMA_VERSION } from '@shared/meeting'
import { checkMeetingFolder, deleteMeetingFolder, type DeleteOps } from './delete'
import { listMeetingFolders, STAGING_PREFIX, writeMeeting } from './repository'

let base: string
let root: string
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'clearmeet-delete-'))
  root = join(base, 'Reunioes')
  await mkdir(root)
})
afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

async function createMeeting(name: string): Promise<string> {
  const folder = join(root, name)
  await mkdir(folder)
  await writeMeeting(folder, {
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: name,
    name,
    createdAt: '2026-10-10T17:30:00.000Z',
    endedAt: null,
    durationMs: null,
    status: 'ready',
    source: { kind: 'none', name: null },
    quality: '1080p',
    video: null,
    audio: { file: 'audio.opus' },
    inputs: { mic: true, systemAudio: true },
    notes: [],
    issues: []
  })
  await writeFile(join(folder, 'audio.opus'), 'dados')
  return folder
}

describe('checkMeetingFolder', () => {
  it('aceita a pasta de uma Reunião dentro da pasta configurada', async () => {
    const folder = await createMeeting('a')
    expect(await checkMeetingFolder(root, folder)).toEqual({ ok: true, value: folder })
  })

  it('recusa caminhos fora da pasta das Reuniões ou com ..', async () => {
    await createMeeting('a')
    const outside = join(base, 'fora')
    await mkdir(outside)
    await writeFile(join(outside, MEETING_FILE), '{}')
    for (const folder of [
      outside,
      root,
      base,
      join(root, '..', 'fora'),
      join(root, 'a', '..', '..', 'fora'),
      join(root, 'a', 'sub'),
      join(root, '..'),
      '',
      'a',
      42,
      null
    ]) {
      const result = await checkMeetingFolder(root, folder)
      expect(result.ok, String(folder)).toBe(false)
    }
  })

  it('recusa pasta sem meeting.json, arquivo e pasta temporária de exclusão', async () => {
    const empty = join(root, 'vazia')
    await mkdir(empty)
    const file = join(root, 'arquivo')
    await writeFile(file, 'x')
    const staging = await createMeeting(`${STAGING_PREFIX}1`)
    for (const folder of [empty, file, staging]) {
      expect((await checkMeetingFolder(root, folder)).ok).toBe(false)
    }
  })

  it('pasta inexistente é not-found', async () => {
    const result = await checkMeetingFolder(root, join(root, 'nada'))
    expect(result).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })

  it('recusa atalho (link simbólico) para uma Reunião', async () => {
    const target = await createMeeting('alvo')
    const link = join(root, 'atalho')
    try {
      await symlink(target, link, 'junction')
    } catch {
      return
    }
    expect((await checkMeetingFolder(root, link)).ok).toBe(false)
  })
})

describe('deleteMeetingFolder', () => {
  it('apaga a pasta inteira, sem deixar temporários, e preserva as outras Reuniões', async () => {
    const folder = await createMeeting('a')
    await createMeeting('b')
    await mkdir(join(folder, 'sub'))
    await writeFile(join(folder, 'sub', 'x.txt'), 'x')

    expect(await deleteMeetingFolder(root, folder)).toEqual({ ok: true, value: null })
    expect(await readdir(root)).toEqual(['b'])
  })

  it('recusa caminho fora da pasta das Reuniões sem apagar nada', async () => {
    const outside = join(base, 'fora')
    await mkdir(outside)
    await writeFile(join(outside, MEETING_FILE), '{}')
    const result = await deleteMeetingFolder(root, join(root, '..', 'fora'))
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(await readdir(outside)).toEqual([MEETING_FILE])
  })

  it('pasta em uso: a Reunião continua inteira e o erro é curto', async () => {
    const folder = await createMeeting('a')
    const ops: DeleteOps = {
      renameFolder: () => Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' })),
      removeFolder: () => Promise.reject(new Error('não deveria apagar'))
    }
    const result = await deleteMeetingFolder(root, folder, ops)
    expect(result).toMatchObject({ ok: false, error: { code: 'busy' } })
    expect(await readdir(folder)).toEqual(['audio.opus', MEETING_FILE])
    expect(await readdir(root)).toEqual(['a'])
  })

  it('falha ao apagar depois do rename: o nome volta e a pasta não vira lixo escondido', async () => {
    const folder = await createMeeting('a')
    const renames: string[] = []
    const ops: DeleteOps = {
      renameFolder: async (from, to) => {
        renames.push(`${from} -> ${to}`)
        const { rename } = await import('node:fs/promises')
        await rename(from, to)
      },
      removeFolder: () => Promise.reject(new Error('EBUSY'))
    }
    const result = await deleteMeetingFolder(root, folder, ops)
    expect(result).toMatchObject({ ok: false, error: { code: 'busy' } })
    expect(renames).toHaveLength(2)
    expect(await readdir(root)).toEqual(['a'])
  })

  it('a Biblioteca não enxerga a pasta temporária', async () => {
    await createMeeting('a')
    await mkdir(join(root, `${STAGING_PREFIX}x`))
    expect(await listMeetingFolders(root)).toEqual([join(root, 'a')])
  })
})
