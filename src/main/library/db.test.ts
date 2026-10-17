import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildFtsQuery } from '@shared/search'
import {
  hasFts5,
  IN_MEMORY,
  LIBRARY_SCHEMA_VERSION,
  openLibraryDb,
  type FragmentInput,
  type LibraryDb,
  type MeetingRow
} from './db'
import { loadSqlite, type SqliteModule } from './sqlite'

const sqlite: SqliteModule = await loadSqlite()
// O `node:sqlite` de alguns Node 22 vem sem FTS5; no CI (Node 24, como o Electron) sempre rodam.
const suite = describe.skipIf(!process.env.CI && !hasFts5(sqlite))

function row(overrides: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: 'a',
    folderName: 'pasta-a',
    name: 'Reunião A',
    createdAt: '2026-10-10T17:30:00.000Z',
    createdMs: Date.parse('2026-10-10T17:30:00.000Z'),
    durationMs: 60_000,
    status: 'ready',
    sourceKind: 'screen',
    sourceName: null,
    sizeBytes: 100,
    noteCount: 0,
    transcriptStatus: 'none',
    summaryStatus: 'none',
    hasVideo: true,
    videoSig: '10:1',
    signature: 'sig-1',
    ...overrides
  }
}

function fragment(body: string, overrides: Partial<FragmentInput> = {}): FragmentInput {
  return { kind: 'utterance', offsetMs: 1000, speaker: 'Maria', body, ...overrides }
}

function search(db: LibraryDb, text: string): string[] {
  return db
    .query({ fts: buildFtsQuery(text), fromMs: null, toMs: null, sort: 'newest', limit: 50 })
    .rows.map((meeting) => meeting.id)
}

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'clearmeet-db-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

suite('esquema do índice', () => {
  it('cria o esquema na primeira abertura e o reaproveita nas seguintes', () => {
    const path = join(dir, 'library.db')
    const first = openLibraryDb(sqlite, path)
    first.upsert(row(), [fragment('olá')])
    first.close()

    const second = openLibraryDb(sqlite, path)
    expect(second.count()).toBe(1)
    second.close()
  })

  it('descarta e recria o índice de outra versão', () => {
    const path = join(dir, 'library.db')
    const old = new sqlite.DatabaseSync(path)
    old.exec(`CREATE TABLE meetings (id TEXT); PRAGMA user_version = ${LIBRARY_SCHEMA_VERSION + 1}`)
    old.close()

    const logs: string[] = []
    const db = openLibraryDb(sqlite, path, (message) => logs.push(message))
    expect(db.count()).toBe(0)
    expect(logs.join(' ')).toContain('descartado')
    db.upsert(row(), [])
    expect(db.count()).toBe(1)
    db.close()
  })

  it('descarta e recria um arquivo que não é um banco', async () => {
    const path = join(dir, 'library.db')
    await writeFile(path, 'isto não é um banco de dados SQLite, é só lixo '.repeat(50))
    const db = openLibraryDb(sqlite, path)
    expect(db.count()).toBe(0)
    db.upsert(row(), [])
    expect(db.count()).toBe(1)
    db.close()
  })
})

suite('índice e busca', () => {
  let db: LibraryDb
  beforeEach(() => {
    db = openLibraryDb(sqlite, IN_MEMORY)
  })
  afterEach(() => {
    db.close()
  })

  it('a busca ignora acentos e maiúsculas e casa por prefixo', () => {
    db.upsert(row(), [fragment('Fechamos o orçamento do trimestre')])
    expect(search(db, 'ORCAMENTO')).toEqual(['a'])
    expect(search(db, 'orçam')).toEqual(['a'])
    expect(search(db, 'trimestre fechamos')).toEqual(['a'])
    expect(search(db, 'orcamento semestre')).toEqual([])
  })

  it('trocar o conteúdo remove o texto antigo da busca', () => {
    db.upsert(row(), [fragment('assunto antigo')])
    db.upsert(row({ signature: 'sig-2' }), [fragment('assunto novo')])
    expect(search(db, 'antigo')).toEqual([])
    expect(search(db, 'novo')).toEqual(['a'])
  })

  it('remover a pasta tira a Reunião e o texto da busca', () => {
    db.upsert(row(), [fragment('segredo')])
    expect(db.remove('PASTA-A')).toBe('a')
    expect(search(db, 'segredo')).toEqual([])
    expect(db.count()).toBe(0)
    expect(db.remove('pasta-a')).toBeNull()
  })

  it('devolve os melhores trechos de cada Reunião, com Falante, tipo e Instante', () => {
    db.upsert(row(), [
      fragment('o orçamento subiu', { offsetMs: 5000 }),
      fragment('nada a ver', { offsetMs: 9000 }),
      fragment('revisar orçamento amanhã', { kind: 'note', offsetMs: 7000, speaker: null })
    ])
    const hits = db.hits(buildFtsQuery('orcamento') as string, ['a'], 3).get('a')
    expect(hits?.total).toBe(2)
    expect(hits?.hits.map((hit) => [hit.kind, hit.offsetMs, hit.speaker]).sort()).toEqual([
      ['note', 7000, null],
      ['utterance', 5000, 'Maria']
    ])
  })

  it('o nome da Reunião pesa mais que um trecho da conversa na relevância', () => {
    db.upsert(row({ id: 'fala', folderName: 'fala', name: 'Outra coisa' }), [
      fragment('vamos falar de marketing')
    ])
    db.upsert(row({ id: 'nome', folderName: 'nome', name: 'Marketing' }), [
      fragment('marketing', { kind: 'name', offsetMs: null, speaker: null })
    ])
    const result = db.query({
      fts: buildFtsQuery('marketing'),
      fromMs: null,
      toMs: null,
      sort: 'relevance',
      limit: 10
    })
    expect(result.rows.map((meeting) => meeting.id)).toEqual(['nome', 'fala'])
    expect(result.total).toBe(2)
  })

  it('o Falante também é pesquisável', () => {
    db.upsert(row(), [fragment('bom dia', { speaker: 'Joana Pereira' })])
    expect(search(db, 'joana')).toEqual(['a'])
  })

  it('o filtro de datas é [início, fim) sobre o início da gravação', () => {
    const day = (iso: string): number => Date.parse(iso)
    db.upsert(row({ id: 'a', folderName: 'a', createdMs: day('2026-10-09T23:59:59Z') }), [])
    db.upsert(row({ id: 'b', folderName: 'b', createdMs: day('2026-10-10T00:00:00Z') }), [])
    db.upsert(row({ id: 'c', folderName: 'c', createdMs: day('2026-10-10T23:59:59Z') }), [])
    db.upsert(row({ id: 'd', folderName: 'd', createdMs: day('2026-10-11T00:00:00Z') }), [])
    const ids = (fromMs: number | null, toMs: number | null): string[] =>
      db
        .query({ fts: null, fromMs, toMs, sort: 'oldest', limit: 10 })
        .rows.map((meeting) => meeting.id)
    expect(ids(day('2026-10-10T00:00:00Z'), day('2026-10-11T00:00:00Z'))).toEqual(['b', 'c'])
    expect(ids(day('2026-10-10T00:00:00Z'), null)).toEqual(['b', 'c', 'd'])
    expect(ids(null, day('2026-10-10T00:00:00Z'))).toEqual(['a'])
    expect(ids(null, null)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ordena por mais recente, mais antiga e mais longa (sem duração por último)', () => {
    db.upsert(row({ id: 'a', folderName: 'a', createdMs: 1, durationMs: 50 }), [])
    db.upsert(row({ id: 'b', folderName: 'b', createdMs: 2, durationMs: null }), [])
    db.upsert(row({ id: 'c', folderName: 'c', createdMs: 3, durationMs: 90 }), [])
    const order = (sort: 'newest' | 'oldest' | 'longest' | 'relevance'): string[] =>
      db.query({ fts: null, fromMs: null, toMs: null, sort, limit: 10 }).rows.map((r) => r.id)
    expect(order('newest')).toEqual(['c', 'b', 'a'])
    expect(order('oldest')).toEqual(['a', 'b', 'c'])
    expect(order('longest')).toEqual(['c', 'a', 'b'])
    expect(order('relevance')).toEqual(['c', 'b', 'a'])
  })

  it('o limite corta a lista mas o total conta todas', () => {
    for (const id of ['a', 'b', 'c']) {
      db.upsert(row({ id, folderName: id, createdMs: id.charCodeAt(0) }), [])
    }
    const result = db.query({ fts: null, fromMs: null, toMs: null, sort: 'newest', limit: 2 })
    expect(result.rows).toHaveLength(2)
    expect(result.total).toBe(3)
  })

  it('a miniatura gerada sobrevive à reindexação e fica pendente se o Vídeo muda', () => {
    db.upsert(row(), [])
    expect(db.pendingThumbnails().map((item) => item.id)).toEqual(['a'])
    db.setThumbnail('a', '10:1', true, 123)
    expect(db.pendingThumbnails()).toEqual([])

    db.upsert(row({ signature: 'sig-2', name: 'Novo nome' }), [])
    expect(db.find('a')).toMatchObject({ thumbSig: '10:1', thumbOk: true, thumbAt: 123 })
    expect(db.pendingThumbnails()).toEqual([])

    db.upsert(row({ signature: 'sig-3', videoSig: '20:2' }), [])
    expect(db.pendingThumbnails().map((item) => item.id)).toEqual(['a'])
  })

  it('só Reuniões prontas e com Vídeo pedem miniatura', () => {
    db.upsert(row({ id: 'a', folderName: 'a', hasVideo: false, videoSig: null }), [])
    db.upsert(row({ id: 'b', folderName: 'b', status: 'processing' }), [])
    db.upsert(row({ id: 'c', folderName: 'c' }), [])
    expect(db.pendingThumbnails().map((item) => item.id)).toEqual(['c'])
  })

  it('duas Reuniões não ocupam a mesma pasta (a mais nova vence)', () => {
    db.upsert(row({ id: 'velha' }), [])
    db.upsert(row({ id: 'nova' }), [])
    expect(db.count()).toBe(1)
    expect(db.findByFolder('PASTA-A')?.id).toBe('nova')
  })

  it('pastas ignoradas ficam guardadas até mudarem', () => {
    db.markSkipped('Quebrada', 'sig')
    expect(db.skippedCount()).toBe(1)
    expect(db.skippedFolders().get('quebrada')).toBe('sig')
    db.upsert(row({ folderName: 'quebrada' }), [])
    expect(db.skippedCount()).toBe(0)
  })
})
