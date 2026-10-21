import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GROUPS_DIR, GROUPS_FILE, type GroupDef } from '@shared/groups'
import { GroupStore } from './store'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clearmeet-groups-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const dir = (): string => join(root, GROUPS_DIR)
const file = (): string => join(dir(), GROUPS_FILE)

function group(id: string, name: string): GroupDef {
  return { id, name, description: '', createdAt: '2026-10-01T00:00:00.000Z', rules: null }
}

describe('leitura', () => {
  it('sem arquivo é vazio e não cria nada na pasta', async () => {
    const store = new GroupStore(() => root)
    const read = await store.read()
    expect(read).toEqual({ ok: true, file: { groups: [], dismissed: [] }, corrupt: false })
    expect(await readdir(root)).toEqual([])
  })

  it('aceita BOM e ignora o que é inválido', async () => {
    await mkdir(dir())
    await writeFile(
      file(),
      `${String.fromCharCode(0xfeff)}${JSON.stringify({ groups: [{ id: 'a', name: 'Daily' }, { id: 'a', name: 'Dup' }, 7] })}`
    )
    const read = await new GroupStore(() => root).read()
    expect(read.ok && read.file.groups.map((item) => item.name)).toEqual(['Daily'])
  })

  it('arquivo corrompido abre vazio e avisa', async () => {
    await mkdir(dir())
    await writeFile(file(), '{ não é json')
    const read = await new GroupStore(() => root).read()
    expect(read).toMatchObject({ ok: true, corrupt: true, file: { groups: [] } })
  })

  it('arquivo que não pode ser lido deixa os grupos indisponíveis, sem lançar', async () => {
    await mkdir(file(), { recursive: true })
    const read = await new GroupStore(() => root).read()
    expect(read.ok).toBe(false)
    expect(await new GroupStore(() => root).ids()).toEqual([])
  })
})

describe('escrita', () => {
  it('grava de forma atômica em .clearmeet/groups.json, sem temporários', async () => {
    const store = new GroupStore(() => root)
    const saved = await store.update((current) => ({
      ...current,
      groups: [group('a', 'Daily')],
      dismissed: ['name:x']
    }))
    expect(saved.ok).toBe(true)
    expect(await readdir(dir())).toEqual([GROUPS_FILE])
    const stored = JSON.parse(await readFile(file(), 'utf8')) as Record<string, unknown>
    expect(stored).toMatchObject({ schemaVersion: 1, dismissed: ['name:x'] })
    const again = await new GroupStore(() => root).read()
    expect(again.ok && again.file.groups.map((item) => item.id)).toEqual(['a'])
  })

  it('sem mudança não reescreve o arquivo', async () => {
    const store = new GroupStore(() => root)
    const result = await store.update(() => null)
    expect(result.ok).toBe(true)
    expect(await readdir(root)).toEqual([])
  })

  it('o texto devolvido por quem altera vira recusa, sem gravar', async () => {
    const store = new GroupStore(() => root)
    const result = await store.update(() => 'Já existe.')
    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid-request', message: 'Já existe.' }
    })
    expect(await readdir(root)).toEqual([])
  })

  it('alterações simultâneas passam em fila e nenhuma se perde', async () => {
    const store = new GroupStore(() => root)
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((id) =>
        store.update((current) => ({ ...current, groups: [...current.groups, group(id, id)] }))
      )
    )
    const read = await store.read()
    expect(read.ok && read.file.groups.map((item) => item.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('guarda o arquivo corrompido antes de substituí-lo', async () => {
    await mkdir(dir())
    await writeFile(file(), 'lixo')
    const store = new GroupStore(() => root)
    const saved = await store.update((current) => ({ ...current, groups: [group('a', 'Daily')] }))
    expect(saved.ok).toBe(true)
    expect(await readFile(join(dir(), 'groups.corrupt.json'), 'utf8')).toBe('lixo')
    const read = await store.read()
    expect(read.ok && read.file.groups).toHaveLength(1)
  })

  it('segue a pasta das Reuniões atual, sem guardar nada de uma pasta anterior', async () => {
    const other = await mkdtemp(join(tmpdir(), 'clearmeet-groups-'))
    try {
      let current = root
      const store = new GroupStore(() => current)
      await store.update((file) => ({ ...file, groups: [group('a', 'Daily')] }))
      current = other
      const read = await store.read()
      expect(read.ok && read.file.groups).toEqual([])
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })
})

describe('pasta que não aceita gravar', () => {
  it('a falha vira mensagem, os grupos ficam indisponíveis e voltam ao testar de novo', async () => {
    // Um arquivo no lugar de `.clearmeet` impede criar a pasta.
    await writeFile(dir(), 'bloqueio')
    const store = new GroupStore(() => root)
    const failed = await store.update((current) => ({ ...current, groups: [group('a', 'Daily')] }))
    expect(failed.ok).toBe(false)
    const status = await store.status(false)
    expect(status.editable).toBe(false)
    expect(status.message).toBeTruthy()
    expect((await store.status(true)).editable).toBe(false)

    await rm(dir())
    expect(await store.status(false)).toMatchObject({ editable: false })
    expect(await store.status(true)).toEqual({ editable: true, message: null })
    expect((await store.update((c) => ({ ...c, groups: [group('a', 'Daily')] }))).ok).toBe(true)
  })
})
