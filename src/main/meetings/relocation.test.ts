import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RelocationProgress } from '@shared/relocation'
import { MeetingsRelocation, type RelocationDeps } from './relocation'

let base: string
let current: string
let target: string

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'clearmeet-relocation-'))
  current = join(base, 'atual')
  target = join(base, 'nova')
  await mkdir(current)
  await mkdir(target)
  for (const name of ['a', 'b']) {
    await mkdir(join(current, name))
    await writeFile(join(current, name, 'meeting.json'), '{}')
    await writeFile(join(current, name, 'video.mp4'), 'x'.repeat(500))
  }
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

function setup(overrides: Partial<RelocationDeps> = {}) {
  const calls: string[] = []
  const progress: RelocationProgress[] = []
  let dir = current
  const deps: RelocationDeps = {
    currentDir: () => dir,
    chooseFolder: () => Promise.resolve(target),
    busyReason: () => null,
    pause: () => {
      calls.push('pause')
      return Promise.resolve()
    },
    resume: () => {
      calls.push('resume')
    },
    commit: (newDir) => {
      calls.push(`commit:${newDir}`)
      dir = newDir
      return Promise.resolve()
    },
    emit: (event) => progress.push(event),
    log: () => undefined,
    ...overrides
  }
  return { relocation: new MeetingsRelocation(deps), calls, progress }
}

describe('MeetingsRelocation.choose', () => {
  it('valida a pasta e mede as Reuniões da pasta atual', async () => {
    const { relocation } = setup()
    const result = await relocation.choose()
    expect(result).toEqual({
      ok: true,
      value: { currentDir: current, newDir: target, meetingCount: 2, totalBytes: 1004 }
    })
  })

  it('cancelar o seletor não é erro', async () => {
    const { relocation } = setup({ chooseFolder: () => Promise.resolve(null) })
    expect(await relocation.choose()).toEqual({ ok: true, value: null })
  })

  it('recusa a mesma pasta e uma pasta dentro da atual', async () => {
    const same = setup({ chooseFolder: () => Promise.resolve(current) })
    expect((await same.relocation.choose()).ok).toBe(false)
    const inside = join(current, 'a')
    const nested = setup({ chooseFolder: () => Promise.resolve(inside) })
    expect((await nested.relocation.choose()).ok).toBe(false)
  })

  it('com gravação ou IA em andamento, recusa antes mesmo de abrir o seletor', async () => {
    let opened = false
    const { relocation } = setup({
      busyReason: () => 'Há uma gravação em andamento.',
      chooseFolder: () => {
        opened = true
        return Promise.resolve(target)
      }
    })
    expect(await relocation.choose()).toEqual({
      ok: false,
      error: { code: 'busy', message: 'Há uma gravação em andamento.' }
    })
    expect(opened).toBe(false)
  })
})

async function writeGroups(dir: string): Promise<void> {
  await mkdir(join(dir, '.clearmeet'), { recursive: true })
  await writeFile(join(dir, '.clearmeet', 'groups.json'), '{"groups":[]}')
}

describe('MeetingsRelocation.apply', () => {
  it('leva a definição dos grupos (.clearmeet/groups.json) junto com as Reuniões', async () => {
    await writeGroups(current)
    const { relocation } = setup()
    await relocation.choose()
    const result = await relocation.apply({ newDir: target, move: true })
    expect(result).toMatchObject({ ok: true, value: { moved: 2, total: 2 } })
    expect(await readFile(join(target, '.clearmeet', 'groups.json'), 'utf8')).toBe('{"groups":[]}')
    expect((await readdir(current)).sort()).toEqual([])
  })

  it('sem mover as Reuniões, os grupos ficam onde estão', async () => {
    await writeGroups(current)
    const { relocation } = setup()
    await relocation.choose()
    await relocation.apply({ newDir: target, move: false })
    expect(await readdir(target)).toEqual([])
    expect(await readdir(join(current, '.clearmeet'))).toEqual(['groups.json'])
  })

  it('não sobrescreve os grupos que já existem na pasta nova', async () => {
    await writeGroups(current)
    await mkdir(join(target, '.clearmeet'))
    await writeFile(join(target, '.clearmeet', 'groups.json'), 'da pasta nova')
    const { relocation } = setup()
    await relocation.choose()
    const result = await relocation.apply({ newDir: target, move: true })
    expect(result.ok).toBe(true)
    expect(await readFile(join(target, '.clearmeet', 'groups.json'), 'utf8')).toBe('da pasta nova')
    expect(await readdir(join(current, '.clearmeet'))).toEqual(['groups.json'])
  })

  it('se alguma Reunião ficou para trás, copia os grupos em vez de mover', async () => {
    await writeGroups(current)
    const { relocation } = setup({
      ops: {
        rename: (from) => {
          if (from.endsWith('b')) {
            return Promise.reject(Object.assign(new Error('em uso'), { code: 'EBUSY' }))
          }
          return rename(from, join(target, 'a'))
        },
        copyFile: () => Promise.reject(new Error('não deveria copiar')),
        remove: () => Promise.resolve()
      }
    })
    await relocation.choose()
    const result = await relocation.apply({ newDir: target, move: true })
    expect(result).toMatchObject({ ok: true, value: { moved: 1 } })
    expect(await readdir(join(target, '.clearmeet'))).toEqual(['groups.json'])
    expect(await readdir(join(current, '.clearmeet'))).toEqual(['groups.json'])
  })

  it('move as Reuniões, grava a pasta nova e reporta o resumo', async () => {
    const { relocation, calls, progress } = setup()
    await relocation.choose()
    const result = await relocation.apply({ newDir: target, move: true })
    expect(result).toEqual({
      ok: true,
      value: {
        previousDir: current,
        newDir: target,
        moveRequested: true,
        total: 2,
        moved: 2,
        issues: [],
        notAttempted: 0,
        leftovers: 0
      }
    })
    expect((await readdir(target)).sort()).toEqual(['a', 'b'])
    expect(await readdir(current)).toEqual([])
    expect(calls).toEqual(['pause', `commit:${target}`, 'resume'])
    expect(progress.at(-1)).toMatchObject({ current: 2, total: 2, bytesDone: 1004 })
    expect(relocation.previousDir()).toBe(current)
    expect(relocation.isRunning).toBe(false)
  })

  it('"só trocar a pasta": nada é movido, a pasta passa a valer', async () => {
    const { relocation, calls } = setup()
    await relocation.choose()
    const result = await relocation.apply({ newDir: target, move: false })
    expect(result).toMatchObject({ ok: true, value: { moveRequested: false, total: 0, moved: 0 } })
    expect(await readdir(target)).toEqual([])
    expect((await readdir(current)).sort()).toEqual(['a', 'b'])
    expect(calls).toContain(`commit:${target}`)
  })

  it('só aceita a pasta que foi escolhida pelo seletor', async () => {
    const { relocation, calls } = setup()
    expect((await relocation.apply({ newDir: target, move: true })).ok).toBe(false)
    await relocation.choose()
    const other = join(base, 'outra')
    await mkdir(other)
    expect((await relocation.apply({ newDir: other, move: true })).ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('a escolha vale uma vez só', async () => {
    const { relocation } = setup()
    await relocation.choose()
    expect((await relocation.apply({ newDir: target, move: false })).ok).toBe(true)
    expect((await relocation.apply({ newDir: target, move: false })).ok).toBe(false)
  })

  it('recusa se a IA começou depois da escolha, sem pausar nada', async () => {
    let busy: string | null = null
    const { relocation, calls } = setup({ busyReason: () => busy })
    await relocation.choose()
    busy = 'A IA está trabalhando.'
    expect(await relocation.apply({ newDir: target, move: true })).toMatchObject({
      ok: false,
      error: { code: 'busy' }
    })
    expect(calls).toEqual([])
  })

  it('retoma o que foi pausado mesmo quando a troca falha', async () => {
    const { relocation, calls } = setup({
      commit: () => Promise.reject(new Error('disco cheio'))
    })
    await relocation.choose()
    const result = await relocation.apply({ newDir: target, move: false })
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown' } })
    expect(calls).toEqual(['pause', 'resume'])
    expect(relocation.isRunning).toBe(false)
  })

  it('durante a troca, novas escolhas e trocas são recusadas e cancelar para as próximas', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { relocation } = setup({
      pause: async () => {
        await gate
      }
    })
    await relocation.choose()
    const running = relocation.apply({ newDir: target, move: true })
    expect(relocation.isRunning).toBe(true)
    expect(await relocation.choose()).toMatchObject({ ok: false, error: { code: 'busy' } })
    expect(await relocation.apply({ newDir: target, move: true })).toMatchObject({
      ok: false,
      error: { code: 'busy' }
    })
    relocation.cancel()
    release()
    const result = await running
    expect(result).toMatchObject({ ok: true, value: { moved: 0, notAttempted: 2 } })
    expect((await readdir(current)).sort()).toEqual(['a', 'b'])
  })
})
