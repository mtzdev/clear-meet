import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_RELOCATE_OPS,
  isInside,
  listMeetingFolders,
  relocateMeetings,
  validateNewDir,
  type RelocateOps,
  type RelocateProgress
} from './relocate'

let base: string
let from: string
let to: string

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'clearmeet-relocate-'))
  from = join(base, 'antiga')
  to = join(base, 'nova')
  await mkdir(from)
  await mkdir(to)
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

async function makeMeeting(
  root: string,
  name: string,
  files: Record<string, string> = {}
): Promise<void> {
  await mkdir(join(root, name), { recursive: true })
  const content = { 'meeting.json': '{}', 'video.mp4': 'v'.repeat(1000), ...files }
  for (const [file, text] of Object.entries(content)) {
    await writeFile(join(root, name, file), text)
  }
}

function errorWith(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

/** Rename que falha como entre volumes, para forçar o caminho de cópia. */
const crossVolume: RelocateOps = {
  ...DEFAULT_RELOCATE_OPS,
  rename: () => Promise.reject(errorWith('EXDEV'))
}

describe('isInside', () => {
  it('só é verdade para pasta estritamente dentro da outra', () => {
    expect(isInside(from, join(from, 'a'))).toBe(true)
    expect(isInside(from, join(from, 'a', 'b'))).toBe(true)
    expect(isInside(from, from)).toBe(false)
    expect(isInside(from, join(base, 'antiga2'))).toBe(false)
    expect(isInside(join(from, 'a'), from)).toBe(false)
  })
})

describe('validateNewDir', () => {
  it('aceita uma pasta gravável e diferente', async () => {
    const result = await validateNewDir(from, to)
    expect(result).toEqual({ ok: true, value: to })
    expect(await readdir(to)).toEqual([])
  })

  it('recusa a mesma pasta, uma dentro da outra e caminhos inválidos', async () => {
    const inside = join(from, 'sub')
    await mkdir(inside)
    for (const candidate of [from, inside, base, '', 'relativa', 42, null]) {
      const result = await validateNewDir(from, candidate)
      expect(result.ok).toBe(false)
    }
  })

  it('recusa pasta inexistente', async () => {
    const result = await validateNewDir(from, join(base, 'nao-existe'))
    expect(result).toMatchObject({ ok: false, error: { code: 'not-found' } })
  })

  it('recusa arquivo no lugar de pasta', async () => {
    const file = join(base, 'arquivo.txt')
    await writeFile(file, 'x')
    expect((await validateNewDir(from, file)).ok).toBe(false)
  })
})

describe('listMeetingFolders', () => {
  it('lista só pastas com meeting.json, com o tamanho, em ordem de nome', async () => {
    await makeMeeting(from, 'b-reuniao', { 'audio.opus': 'a'.repeat(50) })
    await makeMeeting(from, 'a-reuniao')
    await mkdir(join(from, 'outra-coisa'))
    await writeFile(join(from, 'outra-coisa', 'x.txt'), 'x')
    await mkdir(join(from, '.excluindo-123'))
    await writeFile(join(from, '.excluindo-123', 'meeting.json'), '{}')
    await writeFile(join(from, 'solto.txt'), 'x')

    const list = await listMeetingFolders(from)
    expect(list.map((item) => item.name)).toEqual(['a-reuniao', 'b-reuniao'])
    expect(list.map((item) => item.bytes)).toEqual([1002, 1052])
  })

  it('pasta inexistente: lista vazia', async () => {
    expect(await listMeetingFolders(join(base, 'nada'))).toEqual([])
  })
})

describe('relocateMeetings', () => {
  it('mesmo volume: move com rename, sem copiar', async () => {
    await makeMeeting(from, 'a')
    await makeMeeting(from, 'b')
    const meetings = await listMeetingFolders(from)
    const copied: string[] = []
    const result = await relocateMeetings({
      to,
      meetings,
      ops: {
        ...DEFAULT_RELOCATE_OPS,
        copyFile: (source) => {
          copied.push(source)
          return Promise.resolve()
        }
      }
    })
    expect(result).toEqual({ moved: 2, issues: [], notAttempted: 0, leftovers: 0 })
    expect(copied).toEqual([])
    expect((await readdir(to)).sort()).toEqual(['a', 'b'])
    expect(await readdir(from)).toEqual([])
    expect(await readFile(join(to, 'a', 'meeting.json'), 'utf8')).toBe('{}')
  })

  it('volumes diferentes (EXDEV): copia, confere e só então apaga a origem', async () => {
    await makeMeeting(from, 'a', { 'audio.opus': 'opus' })
    await mkdir(join(from, 'a', 'sub'))
    await writeFile(join(from, 'a', 'sub', 'x.txt'), 'dentro')
    const meetings = await listMeetingFolders(from)
    const result = await relocateMeetings({ to, meetings, ops: crossVolume })
    expect(result).toEqual({ moved: 1, issues: [], notAttempted: 0, leftovers: 0 })
    expect(await readdir(from)).toEqual([])
    expect((await readdir(join(to, 'a'))).sort()).toEqual([
      'audio.opus',
      'meeting.json',
      'sub',
      'video.mp4'
    ])
    expect(await readFile(join(to, 'a', 'sub', 'x.txt'), 'utf8')).toBe('dentro')
    expect((await stat(join(to, 'a', 'video.mp4'))).size).toBe(1000)
  })

  it('falha na cópia: apaga a cópia parcial, mantém a original e segue com as próximas', async () => {
    await makeMeeting(from, 'a')
    await makeMeeting(from, 'b')
    const meetings = await listMeetingFolders(from)
    const ops: RelocateOps = {
      ...crossVolume,
      copyFile: async (source, target, onBytes) => {
        if (source.includes(`${join('a', 'video.mp4')}`)) throw errorWith('EIO')
        await DEFAULT_RELOCATE_OPS.copyFile(source, target, onBytes)
      }
    }
    const result = await relocateMeetings({ to, meetings, ops })
    expect(result.moved).toBe(1)
    expect(result.issues).toEqual([{ name: 'a', reason: 'failed' }])
    expect(await readdir(to)).toEqual(['b'])
    expect((await readdir(from)).sort()).toEqual(['a'])
    expect((await readdir(join(from, 'a'))).sort()).toEqual(['meeting.json', 'video.mp4'])
  })

  it('cópia que não confere com a original é descartada', async () => {
    await makeMeeting(from, 'a')
    const meetings = await listMeetingFolders(from)
    const ops: RelocateOps = {
      ...crossVolume,
      copyFile: async (_source, target) => {
        await writeFile(target, 'cortada')
      }
    }
    const result = await relocateMeetings({ to, meetings, ops })
    expect(result.moved).toBe(0)
    expect(result.issues).toEqual([{ name: 'a', reason: 'failed' }])
    expect(await readdir(to)).toEqual([])
    expect(await readdir(from)).toEqual(['a'])
  })

  it('sem espaço no destino: informa o motivo', async () => {
    await makeMeeting(from, 'a')
    const ops: RelocateOps = {
      ...crossVolume,
      copyFile: () => Promise.reject(errorWith('ENOSPC'))
    }
    const result = await relocateMeetings({ to, meetings: await listMeetingFolders(from), ops })
    expect(result.issues).toEqual([{ name: 'a', reason: 'no-space' }])
    expect(await readdir(to)).toEqual([])
  })

  it('nome já existente no destino: pula e não mexe em nenhuma das duas', async () => {
    await makeMeeting(from, 'a')
    await makeMeeting(to, 'a', { 'meeting.json': '{"outra":true}' })
    const result = await relocateMeetings({ to, meetings: await listMeetingFolders(from) })
    expect(result.moved).toBe(0)
    expect(result.issues).toEqual([{ name: 'a', reason: 'exists' }])
    expect(await readFile(join(to, 'a', 'meeting.json'), 'utf8')).toBe('{"outra":true}')
    expect(await readFile(join(from, 'a', 'meeting.json'), 'utf8')).toBe('{}')
  })

  it('arquivo em uso (EBUSY/EPERM): pula e reporta', async () => {
    await makeMeeting(from, 'a')
    await makeMeeting(from, 'b')
    const ops: RelocateOps = {
      ...DEFAULT_RELOCATE_OPS,
      rename: (source, target) =>
        source.endsWith('a')
          ? Promise.reject(errorWith('EBUSY'))
          : DEFAULT_RELOCATE_OPS.rename(source, target)
    }
    const result = await relocateMeetings({ to, meetings: await listMeetingFolders(from), ops })
    expect(result.moved).toBe(1)
    expect(result.issues).toEqual([{ name: 'a', reason: 'in-use' }])
    expect(await readdir(to)).toEqual(['b'])
    expect(await readdir(from)).toEqual(['a'])
  })

  it('cópia feita, mas a original não pôde ser apagada: conta como movida com sobra', async () => {
    await makeMeeting(from, 'a')
    const ops: RelocateOps = { ...crossVolume, remove: () => Promise.reject(errorWith('EBUSY')) }
    const result = await relocateMeetings({ to, meetings: await listMeetingFolders(from), ops })
    expect(result).toEqual({ moved: 1, issues: [], notAttempted: 0, leftovers: 1 })
    expect(await readdir(to)).toEqual(['a'])
    expect(await readdir(from)).toEqual(['a'])
  })

  it('cancelar interrompe entre as Reuniões e conta as que ficaram', async () => {
    for (const name of ['a', 'b', 'c']) await makeMeeting(from, name)
    let asked = 0
    const result = await relocateMeetings({
      to,
      meetings: await listMeetingFolders(from),
      shouldCancel: () => ++asked > 1
    })
    expect(result.moved).toBe(1)
    expect(result.notAttempted).toBe(2)
    expect(await readdir(to)).toEqual(['a'])
    expect((await readdir(from)).sort()).toEqual(['b', 'c'])
  })

  it('reporta o andamento: Reunião atual, total e bytes, até 100%', async () => {
    await makeMeeting(from, 'a')
    await makeMeeting(from, 'b')
    const meetings = await listMeetingFolders(from)
    const events: RelocateProgress[] = []
    let clock = 0
    await relocateMeetings({
      to,
      meetings,
      ops: crossVolume,
      onProgress: (progress) => events.push(progress),
      now: () => (clock += 1000)
    })
    expect(events[0]).toMatchObject({ current: 1, total: 2, name: 'a', bytesDone: 0 })
    expect(events.some((event) => event.current === 2 && event.name === 'b')).toBe(true)
    const last = events[events.length - 1]
    expect(last).toMatchObject({ current: 2, total: 2, bytesDone: 2004, bytesTotal: 2004 })
    for (const event of events) expect(event.bytesDone).toBeLessThanOrEqual(event.bytesTotal)
  })

  it('sem Reuniões: nada a fazer', async () => {
    expect(await relocateMeetings({ to, meetings: [] })).toEqual({
      moved: 0,
      issues: [],
      notAttempted: 0,
      leftovers: 0
    })
  })
})
