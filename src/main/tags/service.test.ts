import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { meetingTags } from '@shared/meeting'
import { tagKey, type TagInfo } from '@shared/tags'
import { createFolder } from '../library/fixtures'
import { listMeetingFolders, readMeeting } from '../meetings/repository'
import { TagCatalog } from './catalog'
import { TagService } from './service'

let base: string
let root: string
let catalogFile: string
let refreshed: string[]
let changes: number

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'clearmeet-tags-'))
  root = join(base, 'Reunioes')
  catalogFile = join(base, 'tags.json')
  await mkdir(root)
  refreshed = []
  changes = 0
})
afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

/** Conta as Tags lendo as pastas, como o índice faria. */
async function indexed(): Promise<TagInfo[]> {
  const counts = new Map<string, TagInfo>()
  for (const folder of await listMeetingFolders(root)) {
    const read = await readMeeting(folder)
    if (!read.ok) continue
    for (const name of meetingTags(read.value)) {
      const key = tagKey(name)
      const entry = counts.get(key) ?? { name, count: 0 }
      entry.count += 1
      counts.set(key, entry)
    }
  }
  return [...counts.values()]
}

function createService(): TagService {
  return new TagService({
    catalog: new TagCatalog(catalogFile),
    meetingsDir: () => root,
    indexed,
    refresh: (folder) => {
      refreshed.push(folder)
      return Promise.resolve()
    },
    emitChanged: () => {
      changes++
    }
  })
}

async function tagsOf(folder: string): Promise<string[]> {
  const read = await readMeeting(folder)
  if (!read.ok) throw new Error(read.error)
  return meetingTags(read.value)
}

async function names(service: TagService): Promise<string[]> {
  return (await service.list()).map((tag) => tag.name)
}

async function folderWith(
  name: string,
  tags: string[],
  status: 'ready' | 'recording' | 'processing' = 'ready'
): Promise<string> {
  return createFolder(root, name, { meeting: { id: name, name, tags, status } })
}

describe('adicionar e remover', () => {
  it('marca a Reunião, grava no catálogo e reindexa', async () => {
    const service = createService()
    const folder = await folderWith('a', [])
    const result = await service.add(folder, '  Daily ')
    expect(result).toEqual({ ok: true, value: ['Daily'] })
    expect(await tagsOf(folder)).toEqual(['Daily'])
    const stored = JSON.parse(await readFile(catalogFile, 'utf8')) as { tags: string[] }
    expect(stored.tags).toEqual(['Daily'])
    expect(refreshed).toEqual([folder])
    expect(changes).toBe(1)
  })

  it('usa a grafia que já existe e não repete a Tag na Reunião', async () => {
    const service = createService()
    const a = await folderWith('a', ['Daily'])
    const b = await folderWith('b', [])
    expect(await service.add(b, 'daily')).toEqual({ ok: true, value: ['Daily'] })
    expect(await service.add(a, 'DAILY')).toEqual({ ok: true, value: ['Daily'] })
    expect(await tagsOf(a)).toEqual(['Daily'])
  })

  it('várias Tags por Reunião', async () => {
    const service = createService()
    const folder = await folderWith('a', [])
    await service.add(folder, 'Daily')
    expect(await service.add(folder, 'Cliente')).toEqual({ ok: true, value: ['Daily', 'Cliente'] })
  })

  it('a Tag continua existindo, com zero Reuniões, depois de removida da última', async () => {
    const service = createService()
    const folder = await folderWith('a', [])
    await service.add(folder, 'Daily')
    expect(await service.remove(folder, 'daily')).toEqual({ ok: true, value: [] })
    expect(await tagsOf(folder)).toEqual([])
    expect(await service.list()).toEqual([{ name: 'Daily', count: 0 }])
  })

  it('recusa a 4ª Tag da Reunião, mas aceita uma que ela já tem', async () => {
    const service = createService()
    const folder = await folderWith('a', ['A', 'B', 'C'])
    expect(await service.add(folder, 'D')).toMatchObject({
      ok: false,
      error: { code: 'invalid-request', message: expect.stringContaining('3') as string }
    })
    expect(await service.add(folder, 'b')).toEqual({ ok: true, value: ['A', 'B', 'C'] })
    expect(await tagsOf(folder)).toEqual(['A', 'B', 'C'])
    expect(await names(service)).toEqual(['A', 'B', 'C'])
  })

  it('recusa nome novo com mais de 16 caracteres', async () => {
    const service = createService()
    const folder = await folderWith('a', [])
    expect(await service.add(folder, 'x'.repeat(17))).toMatchObject({ ok: false })
    expect(await service.create('x'.repeat(17))).toMatchObject({ ok: false })
  })

  it('Tag antiga com nome longo (de outro PC) ainda pode ser tirada, renomeada e apagada', async () => {
    const service = createService()
    const long = 'uma tag bem comprida demais'
    const a = await folderWith('a', [long, 'B', 'C', 'D'])
    expect(await service.remove(a, long)).toEqual({ ok: true, value: ['B', 'C', 'D'] })
    const b = await folderWith('b', [long])
    expect(await service.rename(long, 'Curta')).toEqual({
      ok: true,
      value: { name: 'Curta', updated: 1 }
    })
    expect(await tagsOf(b)).toEqual(['Curta'])
    const c = await folderWith('c', [long])
    expect(await service.delete(long)).toEqual({ ok: true, value: { updated: 1 } })
    expect(await tagsOf(c)).toEqual([])
  })

  it('recusa nome inválido e Reunião que ainda grava', async () => {
    const service = createService()
    const live = await folderWith('live', [], 'recording')
    expect(await service.add(live, 'Daily')).toMatchObject({ ok: false, error: { code: 'busy' } })
    expect(await service.add(live, '  ')).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })
    expect(await tagsOf(live)).toEqual([])
  })

  it('recusa pasta fora da pasta das Reuniões', async () => {
    const service = createService()
    expect(await service.add(base, 'Daily')).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })
  })
})

describe('catálogo efetivo', () => {
  it('une o catálogo com as Tags de pastas copiadas de outro PC', async () => {
    const service = createService()
    await service.create('Vazia')
    await folderWith('a', ['Trazida', 'Vazia'])
    expect(await service.list()).toEqual([
      { name: 'Trazida', count: 1 },
      { name: 'Vazia', count: 1 }
    ])
  })

  it('criar uma Tag que já existe não duplica', async () => {
    const service = createService()
    await service.create('Daily')
    expect(await service.create('daily')).toEqual({ ok: true, value: { name: 'Daily', count: 0 } })
    expect(await names(service)).toEqual(['Daily'])
  })

  it('um catálogo corrompido vale como vazio', async () => {
    await writeFile(catalogFile, '{ não é json')
    expect(await names(createService())).toEqual([])
  })

  it('sem o índice, as Tags voltam das pastas e do catálogo', async () => {
    const first = createService()
    const folder = await folderWith('a', [])
    await first.add(folder, 'Daily')
    await first.create('Vazia')
    // Outro serviço = app reaberto: só o disco restou.
    expect(await names(createService())).toEqual(['Daily', 'Vazia'])
  })
})

describe('renomear', () => {
  it('troca a Tag em todas as Reuniões e no catálogo', async () => {
    const service = createService()
    const a = await folderWith('a', ['Daily', 'Cliente'])
    const b = await folderWith('b', ['daily'])
    const c = await folderWith('c', ['Outra'])
    await service.create('Daily')
    const result = await service.rename('Daily', 'Diária')
    expect(result).toEqual({ ok: true, value: { name: 'Diária', updated: 2 } })
    expect(await tagsOf(a)).toEqual(['Diária', 'Cliente'])
    expect(await tagsOf(b)).toEqual(['Diária'])
    expect(await tagsOf(c)).toEqual(['Outra'])
    expect(await names(service)).toEqual(['Cliente', 'Diária', 'Outra'])
    expect([...refreshed].sort()).toEqual([a, b].sort())
  })

  it('para o nome de outra Tag, junta as duas com a grafia da que existia', async () => {
    const service = createService()
    const a = await folderWith('a', ['Daily', 'Diária'])
    const b = await folderWith('b', ['Daily'])
    const c = await folderWith('c', ['Diária'])
    const result = await service.rename('Daily', 'diaria')
    expect(result).toEqual({ ok: true, value: { name: 'Diária', updated: 2 } })
    expect(await tagsOf(a)).toEqual(['Diária'])
    expect(await tagsOf(b)).toEqual(['Diária'])
    expect(await tagsOf(c)).toEqual(['Diária'])
    expect(await service.list()).toEqual([{ name: 'Diária', count: 3 }])
  })

  it('mudar só a caixa troca a grafia', async () => {
    const service = createService()
    const a = await folderWith('a', ['daily'])
    await service.create('daily')
    await service.rename('daily', 'Daily')
    expect(await tagsOf(a)).toEqual(['Daily'])
    expect(await names(service)).toEqual(['Daily'])
  })

  it('renomeia uma Tag vazia, só do catálogo', async () => {
    const service = createService()
    await service.create('Vazia')
    expect(await service.rename('Vazia', 'Livre')).toEqual({
      ok: true,
      value: { name: 'Livre', updated: 0 }
    })
    expect(await names(service)).toEqual(['Livre'])
  })

  it('recusa tudo, sem alterar nada, se uma Reunião afetada ainda grava', async () => {
    const service = createService()
    const ready = await folderWith('a', ['Daily'])
    const live = await folderWith('b', ['Daily'], 'recording')
    const result = await service.rename('Daily', 'Diária')
    expect(result).toMatchObject({ ok: false, error: { code: 'busy' } })
    expect(await tagsOf(ready)).toEqual(['Daily'])
    expect(await tagsOf(live)).toEqual(['Daily'])
  })

  it('uma Reunião que grava sem a Tag não atrapalha', async () => {
    const service = createService()
    const ready = await folderWith('a', ['Daily'])
    await folderWith('b', [], 'recording')
    expect(await service.rename('Daily', 'Diária')).toMatchObject({ ok: true })
    expect(await tagsOf(ready)).toEqual(['Diária'])
  })

  it('não reescreve o meeting.json das Reuniões sem a Tag', async () => {
    const service = createService()
    const other = await folderWith('c', ['Outra'])
    const before = await readFile(join(other, 'meeting.json'), 'utf8')
    await folderWith('a', ['Daily'])
    await service.rename('Daily', 'Diária')
    expect(await readFile(join(other, 'meeting.json'), 'utf8')).toBe(before)
  })
})

describe('apagar', () => {
  it('tira a Tag do catálogo e de todas as Reuniões', async () => {
    const service = createService()
    const a = await folderWith('a', ['Daily', 'Cliente'])
    const b = await folderWith('b', ['daily'])
    await service.create('Daily')
    expect(await service.delete('DAILY')).toEqual({ ok: true, value: { updated: 2 } })
    expect(await tagsOf(a)).toEqual(['Cliente'])
    expect(await tagsOf(b)).toEqual([])
    expect(await names(service)).toEqual(['Cliente'])
    const raw = JSON.parse(await readFile(join(b, 'meeting.json'), 'utf8')) as { tags?: unknown }
    expect(raw.tags).toBeUndefined()
  })

  it('recusa se uma Reunião com a Tag ainda é processada', async () => {
    const service = createService()
    const ready = await folderWith('a', ['Daily'])
    await folderWith('b', ['Daily'], 'processing')
    expect(await service.delete('Daily')).toMatchObject({ ok: false, error: { code: 'busy' } })
    expect(await tagsOf(ready)).toEqual(['Daily'])
    expect(await names(service)).toEqual(['Daily'])
  })
})
