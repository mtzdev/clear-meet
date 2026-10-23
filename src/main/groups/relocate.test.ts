import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { moveGroupsFile } from './relocate'

let from: string
let to: string

beforeEach(async () => {
  from = await mkdtemp(join(tmpdir(), 'clearmeet-de-'))
  to = await mkdtemp(join(tmpdir(), 'clearmeet-para-'))
})
afterEach(async () => {
  await rm(from, { recursive: true, force: true })
  await rm(to, { recursive: true, force: true })
})

async function seed(root: string, chats: Record<string, string> = {}): Promise<void> {
  await mkdir(join(root, '.clearmeet', 'chats'), { recursive: true })
  await writeFile(join(root, '.clearmeet', 'groups.json'), '{"groups":[]}')
  for (const [name, text] of Object.entries(chats)) {
    await writeFile(join(root, '.clearmeet', 'chats', name), text)
  }
}

describe('moveGroupsFile com Conversas', () => {
  it('movendo tudo, leva a definição e as Conversas e limpa a origem', async () => {
    await seed(from, { 'g1.json': 'um', 'g2.json': 'dois' })
    expect(await moveGroupsFile(from, to, true)).toBe('moved')
    expect((await readdir(join(to, '.clearmeet', 'chats'))).sort()).toEqual(['g1.json', 'g2.json'])
    expect(await readFile(join(to, '.clearmeet', 'chats', 'g1.json'), 'utf8')).toBe('um')
    await expect(readdir(join(from, '.clearmeet'))).rejects.toThrow()
  })

  it('movimento incompleto copia: a origem continua com tudo', async () => {
    await seed(from, { 'g1.json': 'um' })
    expect(await moveGroupsFile(from, to, false)).toBe('copied')
    expect(await readdir(join(to, '.clearmeet', 'chats'))).toEqual(['g1.json'])
    expect((await readdir(join(from, '.clearmeet'))).sort()).toEqual(['chats', 'groups.json'])
    expect(await readdir(join(from, '.clearmeet', 'chats'))).toEqual(['g1.json'])
  })

  it('não sobrescreve uma Conversa que já existe no destino', async () => {
    await seed(from, { 'g1.json': 'da origem', 'g2.json': 'nova' })
    await mkdir(join(to, '.clearmeet', 'chats'), { recursive: true })
    await writeFile(join(to, '.clearmeet', 'chats', 'g1.json'), 'do destino')
    expect(await moveGroupsFile(from, to, true)).toBe('moved')
    expect(await readFile(join(to, '.clearmeet', 'chats', 'g1.json'), 'utf8')).toBe('do destino')
    expect(await readFile(join(to, '.clearmeet', 'chats', 'g2.json'), 'utf8')).toBe('nova')
    // O que não foi levado fica na origem, que por isso não é apagada.
    expect(await readdir(join(from, '.clearmeet', 'chats'))).toEqual(['g1.json'])
  })

  it('não mexe em arquivos de outro tipo dentro de chats', async () => {
    await seed(from, { 'g1.json': 'um', 'anotacao.txt': 'meu' })
    await moveGroupsFile(from, to, true)
    expect(await readdir(join(to, '.clearmeet', 'chats'))).toEqual(['g1.json'])
    expect(await readdir(join(from, '.clearmeet', 'chats'))).toEqual(['anotacao.txt'])
  })

  it('sem Conversas, continua funcionando como antes', async () => {
    await seed(from)
    expect(await moveGroupsFile(from, to, true)).toBe('moved')
    expect(await readdir(join(to, '.clearmeet'))).toEqual(['groups.json'])
  })

  it('sem definição de grupos não há o que levar', async () => {
    expect(await moveGroupsFile(from, to, true)).toBe('none')
  })

  it('destino que já tem definição de grupos é deixado em paz', async () => {
    await seed(from, { 'g1.json': 'um' })
    await seed(to)
    expect(await moveGroupsFile(from, to, true)).toBe('exists')
    expect(await readdir(join(to, '.clearmeet', 'chats'))).toEqual([])
  })
})
