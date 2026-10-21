import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MEETING_FILE } from '@shared/meeting'
import { createFolder } from '../library/fixtures'
import { editMeetingGroup, GROUP_BUSY } from './group-store'
import { readMeeting } from './repository'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clearmeet-group-store-'))
  await mkdir(root, { recursive: true })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function groupOf(folder: string): Promise<string | undefined> {
  const read = await readMeeting(folder)
  if (!read.ok) throw new Error(read.error)
  return read.value.groupId
}

describe('editMeetingGroup', () => {
  it('grava o grupo no meeting.json e o tira de novo', async () => {
    const folder = await createFolder(root, 'a')
    expect(await editMeetingGroup(root, folder, () => 'g1')).toEqual({ ok: true, value: 'g1' })
    expect(await groupOf(folder)).toBe('g1')
    expect(await editMeetingGroup(root, folder, () => 'g2')).toEqual({ ok: true, value: 'g2' })
    expect(await editMeetingGroup(root, folder, () => null)).toEqual({ ok: true, value: null })
    expect(await groupOf(folder)).toBeUndefined()
    expect(await readFile(join(folder, MEETING_FILE), 'utf8')).not.toContain('groupId')
  })

  it('sem mudança, o arquivo não é reescrito', async () => {
    const folder = await createFolder(root, 'a', { meeting: { groupId: 'g1' } })
    const before = (await stat(join(folder, MEETING_FILE))).mtimeMs
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await editMeetingGroup(root, folder, () => undefined)).toEqual({
      ok: true,
      value: 'g1'
    })
    expect(await editMeetingGroup(root, folder, () => 'g1')).toEqual({ ok: true, value: 'g1' })
    expect((await stat(join(folder, MEETING_FILE))).mtimeMs).toBe(before)
  })

  it('só Reuniões prontas', async () => {
    for (const status of ['recording', 'processing', 'unprocessed'] as const) {
      const folder = await createFolder(root, status, { meeting: { status } })
      expect(await editMeetingGroup(root, folder, () => 'g1')).toEqual({
        ok: false,
        error: { code: 'busy', message: GROUP_BUSY }
      })
      expect(await groupOf(folder)).toBeUndefined()
    }
  })

  it('recusa pasta fora da pasta das Reuniões e Reunião que não existe', async () => {
    expect(await editMeetingGroup(root, join(root, '..', 'fora'), () => 'g1')).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })
    expect(await editMeetingGroup(root, join(root, 'nao-existe'), () => 'g1')).toMatchObject({
      ok: false,
      error: { code: 'not-found' }
    })
  })

  it('edições simultâneas da mesma pasta não se atropelam', async () => {
    const folder = await createFolder(root, 'a', { meeting: { tags: ['Daily'] } })
    await Promise.all(
      ['g1', 'g2', 'g3', 'g4'].map((id) => editMeetingGroup(root, folder, () => id))
    )
    const read = await readMeeting(folder)
    expect(read.ok && read.value.groupId).toBe('g4')
    expect(read.ok && read.value.tags).toEqual(['Daily'])
  })
})
