import { copyFile, mkdir, mkdtemp, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LIBRARY_QUERY, type LibraryQuery } from '@shared/library'
import { MEETING_FILE } from '@shared/meeting'
import { parseThumbnailUrl } from '@shared/media'
import type { FfmpegTools, ProcessResult, RunProcess } from '../ffmpeg/media'
import { addMeetingNote, deleteMeetingNote } from '../meetings/notes-store'
import { renameMeeting } from '../meetings/repository'
import { renameTranscriptSpeaker } from '../meetings/transcript-store'
import { hasFts5 } from './db'
import { createFolder, makeNote, makeSummary, makeTranscript, type FolderSpec } from './fixtures'
import { LibraryService, normalizeQuery, type LibraryServiceDeps } from './service'
import { loadSqlite, type SqliteModule } from './sqlite'

const sqlite: SqliteModule = await loadSqlite()
// O `node:sqlite` de alguns Node 22 vem sem FTS5; no CI (Node 24, como o Electron) sempre rodam.
const suite = describe.skipIf(!process.env.CI && !hasFts5(sqlite))

const tools: FfmpegTools = { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' }
const ok: ProcessResult = { code: 0, stdout: '', stderr: '' }

let base: string
let root: string
let userData: string
let services: LibraryService[]

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'clearmeet-index-'))
  root = join(base, 'Reunioes')
  userData = join(base, 'userData')
  await mkdir(root)
  await mkdir(userData)
  services = []
})
afterEach(async () => {
  await Promise.all(services.map((service) => service.close()))
  await rm(base, { recursive: true, force: true })
})

interface Harness {
  service: LibraryService
  changes: { count: number }
  thumbCalls: string[][]
}

function createService(overrides: Partial<LibraryServiceDeps> = {}): Harness {
  const changes = { count: 0 }
  const thumbCalls: string[][] = []
  const run: RunProcess = async (_file, args) => {
    thumbCalls.push(args)
    await writeFile(args[args.length - 1] as string, 'JPEG')
    return ok
  }
  let clock = 1_000_000
  const service = new LibraryService({
    dbPath: join(userData, 'library.db'),
    thumbnailsDir: join(userData, 'thumbnails'),
    meetingsDir: () => root,
    activeFolder: () => null,
    loadSqlite: () => Promise.resolve(sqlite),
    getTools: () => Promise.resolve(tools),
    canMakeThumbnails: () => true,
    emitChanged: () => {
      changes.count++
    },
    run,
    now: () => (clock += 10_000),
    log: () => undefined,
    ...overrides
  })
  services.push(service)
  return { service, changes, thumbCalls }
}

async function sync(service: LibraryService): Promise<void> {
  await service.reconcile({ force: true })
  await service.settled()
}

function query(overrides: Partial<LibraryQuery> = {}): LibraryQuery {
  return { ...DEFAULT_LIBRARY_QUERY, ...overrides }
}

async function names(service: LibraryService, overrides: Partial<LibraryQuery> = {}) {
  return (await service.search(query(overrides))).entries.map((entry) => entry.meeting.name)
}

const days = (n: number): string => `2026-10-${String(n).padStart(2, '0')}T12:00:00.000Z`

function spec(
  id: string,
  name: string,
  day: number,
  extra: Omit<FolderSpec, 'meeting'> & { meeting?: Partial<FolderSpec['meeting']> } = {}
): FolderSpec {
  return { ...extra, meeting: { id, name, createdAt: days(day), ...extra.meeting } }
}

describe('normalizeQuery', () => {
  it('confere o pedido da UI e aplica os limites', () => {
    expect(
      normalizeQuery({
        text: 'x'.repeat(500),
        fromMs: Number.NaN,
        toMs: 5,
        sort: 'invalida' as LibraryQuery['sort'],
        limit: 99_999
      })
    ).toEqual({ text: 'x'.repeat(200), fromMs: null, toMs: 5, sort: 'newest', limit: 500 })
    expect(normalizeQuery(query({ limit: 0 })).limit).toBe(1)
    expect(normalizeQuery(query()).limit).toBe(500)
  })
})

suite('indexação', () => {
  it('lista as Reuniões, mais recentes primeiro, com os dados da lista', async () => {
    await createFolder(root, 'antiga', spec('a', 'Antiga', 1))
    await createFolder(
      root,
      'nova',
      spec('n', 'Nova', 12, {
        meeting: {
          source: { kind: 'none', name: null },
          video: null,
          notes: [makeNote('1', 1000, 'um'), makeNote('2', 2000, 'dois')],
          transcript: { status: 'ready', model: 'm', updatedAt: days(12) },
          summary: { status: 'running', updatedAt: days(12) }
        },
        files: { 'audio.opus': 'abcde' }
      })
    )
    const { service } = createService()
    await sync(service)

    const result = await service.search(query())
    expect(result).toMatchObject({ total: 2, indexed: 2, skipped: 0, updating: false })
    expect(result.entries.map((entry) => entry.meeting.id)).toEqual(['n', 'a'])
    expect(result.entries[0]?.meeting).toMatchObject({
      folder: join(root, 'nova'),
      name: 'Nova',
      source: { kind: 'none', name: null },
      noteCount: 2,
      transcriptStatus: 'ready',
      summaryStatus: 'running',
      hasVideo: false,
      thumbnail: null,
      live: false
    })
    // A soma dos arquivos da pasta (meeting.json + audio.opus).
    const size = (await readFile(join(root, 'nova', MEETING_FILE))).length + 5
    expect(result.entries[0]?.meeting.sizeBytes).toBe(size)
  })

  it('ignora o que não é Reunião e conta as ilegíveis, sem alterá-las', async () => {
    await createFolder(root, 'boa', spec('ok', 'Boa', 5))
    await mkdir(join(root, 'sem-json'))
    await writeFile(join(root, 'solto.txt'), 'x')
    await mkdir(join(root, 'quebrada'))
    await writeFile(join(root, 'quebrada', MEETING_FILE), '{ "schemaVersion": 1, ')
    await mkdir(join(root, 'futura'))
    const future = JSON.stringify({ schemaVersion: 99, id: 'f' })
    await writeFile(join(root, 'futura', MEETING_FILE), future)

    const { service } = createService()
    await sync(service)
    const result = await service.search(query())
    expect(result.entries.map((entry) => entry.meeting.id)).toEqual(['ok'])
    expect(result.skipped).toBe(2)
    expect(await readFile(join(root, 'futura', MEETING_FILE), 'utf8')).toBe(future)
  })

  it('pasta das Reuniões inexistente ou vazia = lista vazia', async () => {
    const missing = createService({ meetingsDir: () => join(root, 'nao-existe') })
    await sync(missing.service)
    expect(await names(missing.service)).toEqual([])
    expect((await missing.service.search(query())).indexed).toBe(0)
  })

  it('reconcilia: nova entra, removida sai, alterada é reindexada', async () => {
    const velha = await createFolder(root, 'velha', spec('v', 'Velha', 1))
    await createFolder(root, 'fixa', spec('f', 'Fixa', 2))
    const { service } = createService()
    await sync(service)
    expect(await names(service)).toEqual(['Fixa', 'Velha'])

    await createFolder(root, 'nova', spec('n', 'Nova', 3))
    await rm(velha, { recursive: true })
    await sync(service)
    expect(await names(service)).toEqual(['Nova', 'Fixa'])

    // Alterada por fora: o nome muda no meeting.json (tamanho e data mudam).
    await createFolder(root, 'fixa', spec('f', 'Fixa renomeada por fora', 2))
    const later = new Date(Date.now() + 60_000)
    await utimes(join(root, 'fixa', MEETING_FILE), later, later)
    await sync(service)
    expect(await names(service)).toEqual(['Nova', 'Fixa renomeada por fora'])
    expect((await service.search(query({ text: 'renomeada' }))).entries).toHaveLength(1)
  })

  it('não relê pastas que não mudaram', async () => {
    await createFolder(root, 'a', spec('a', 'A', 1))
    const { service, changes } = createService()
    await sync(service)
    const before = changes.count

    // Mesma assinatura: a varredura termina sem indexar nada (só avisa que acabou).
    await sync(service)
    expect(changes.count - before).toBe(1)
  })

  it('apagar o índice reconstrói a lista a partir das pastas', async () => {
    await createFolder(
      root,
      'a',
      spec('a', 'Planejamento', 1, {
        transcript: makeTranscript([
          { speaker: 'Maria', startMs: 4000, text: 'Fechamos o orçamento' }
        ])
      })
    )
    await createFolder(root, 'b', spec('b', 'Daily', 2))
    const first = createService()
    await sync(first.service)
    await first.service.close()
    await rm(join(userData, 'library.db'))

    const second = createService()
    await sync(second.service)
    expect(await names(second.service)).toEqual(['Daily', 'Planejamento'])
    const found = await second.service.search(query({ text: 'orcamento' }))
    expect(found.entries.map((entry) => entry.meeting.name)).toEqual(['Planejamento'])
  })

  it('índice corrompido é descartado e reconstruído', async () => {
    await createFolder(root, 'a', spec('a', 'A', 1))
    await writeFile(join(userData, 'library.db'), 'lixo que não é SQLite '.repeat(100))
    const { service } = createService()
    await sync(service)
    expect(await names(service)).toEqual(['A'])
  })

  it('trocar a pasta das Reuniões recomeça o índice', async () => {
    await createFolder(root, 'a', spec('a', 'Da pasta antiga', 1))
    const other = join(base, 'Outra')
    await createFolder(other, 'x', spec('x', 'Da pasta nova', 2))
    let current = root
    const { service } = createService({ meetingsDir: () => current })
    await sync(service)
    expect(await names(service)).toEqual(['Da pasta antiga'])

    current = other
    await sync(service)
    expect(await names(service)).toEqual(['Da pasta nova'])
  })

  it('a mesma Reunião copiada em outra pasta fica de fora até a original sumir', async () => {
    const original = await createFolder(root, 'a', spec('mesmo-id', 'Original', 1))
    const { service } = createService()
    await sync(service)

    const copy = join(root, 'a - Copia')
    await mkdir(copy)
    await copyFile(join(original, MEETING_FILE), join(copy, MEETING_FILE))
    await sync(service)
    const result = await service.search(query())
    expect(result.entries.map((entry) => entry.meeting.folder)).toEqual([original])
    expect(result.skipped).toBe(1)

    await rm(original, { recursive: true })
    await sync(service)
    const after = await service.search(query())
    expect(after.entries.map((entry) => entry.meeting.folder)).toEqual([copy])
    expect(after.skipped).toBe(0)
  })

  it('mover/renomear a pasta mantém a Reunião (o id é a identidade)', async () => {
    const folder = await createFolder(root, 'antes', spec('x', 'Reunião X', 1))
    const { service } = createService()
    await sync(service)

    await rename(folder, join(root, 'depois'))
    await sync(service)
    const result = await service.search(query())
    expect(result.entries.map((entry) => entry.meeting.folder)).toEqual([join(root, 'depois')])
    expect(await service.folderFor('x')).toBe(join(root, 'depois'))
  })

  it('folderFor acha a pasta pelo índice e, se ele está defasado, pelas pastas', async () => {
    const folder = await createFolder(root, 'antes', spec('x', 'X', 1))
    const { service } = createService()
    await sync(service)
    expect(await service.folderFor('x')).toBe(folder)

    await rename(folder, join(root, 'movida'))
    expect(await service.folderFor('x')).toBe(join(root, 'movida'))
    expect(await service.folderFor('inexistente')).toBeNull()
  })

  it('a Reunião em gravação aparece como ao vivo', async () => {
    const folder = await createFolder(
      root,
      'gravando',
      spec('g', 'Gravando', 3, { meeting: { status: 'recording', durationMs: null } })
    )
    const { service } = createService({
      activeFolder: () => (process.platform === 'win32' ? folder.toLowerCase() : folder)
    })
    await sync(service)
    const [entry] = (await service.search(query())).entries
    expect(entry?.meeting).toMatchObject({ live: true, status: 'recording', durationMs: null })
  })
})

suite('atualização ao vivo', () => {
  it('refresh reflete Anotações adicionadas, editadas e excluídas', async () => {
    const folder = await createFolder(root, 'a', spec('a', 'Reunião A', 1))
    const { service, changes } = createService()
    await sync(service)

    const added = await addMeetingNote(root, folder, {
      offsetMs: 90_000,
      text: 'Ligar para o fornecedor'
    })
    expect(added.ok).toBe(true)
    const before = changes.count
    await service.refresh(folder)
    expect(changes.count).toBeGreaterThan(before)
    const found = await service.search(query({ text: 'fornecedor' }))
    expect(found.entries[0]?.meeting.noteCount).toBe(1)
    expect(found.entries[0]?.hits[0]).toMatchObject({ kind: 'note', offsetMs: 90_000 })

    if (added.ok) await deleteMeetingNote(root, folder, added.value.id)
    await service.refresh(folder)
    expect((await service.search(query({ text: 'fornecedor' }))).entries).toEqual([])
  })

  it('renomear o Falante atualiza a busca', async () => {
    const folder = await createFolder(
      root,
      'a',
      spec('a', 'Reunião A', 1, {
        transcript: makeTranscript([
          { speaker: 'Falante 1', startMs: 1000, text: 'Bom dia a todos' }
        ]),
        meeting: { transcript: { status: 'ready', model: 'm', updatedAt: days(1) } }
      })
    )
    const { service } = createService()
    await sync(service)
    expect((await service.search(query({ text: 'Carolina' }))).entries).toEqual([])

    await renameTranscriptSpeaker(folder, 's1', 'Carolina')
    await service.refresh(folder)
    const found = await service.search(query({ text: 'Carolina' }))
    expect(found.entries).toHaveLength(1)
    expect(found.entries[0]?.hits[0]?.speaker?.map((part) => part.text).join('')).toBe('Carolina')
  })

  it('renomear a Reunião (nome e pasta) mantém uma só linha', async () => {
    const folder = await createFolder(root, '2026-10-01 1200 - Antigo', spec('a', 'Antigo', 1))
    const { service } = createService()
    await sync(service)

    const renamed = await renameMeeting(root, folder, 'Nome Novo')
    expect(renamed.ok && renamed.value.folderRenamed).toBe(true)
    if (!renamed.ok) return
    await service.refresh(renamed.value.folder)
    const result = await service.search(query())
    expect(result.entries.map((entry) => [entry.meeting.name, entry.meeting.folder])).toEqual([
      ['Nome Novo', renamed.value.folder]
    ])
    expect((await service.search(query({ text: 'antigo' }))).entries).toEqual([])
  })

  it('a gravação que termina entra no índice; Transcrição pronta muda o status', async () => {
    const { service } = createService()
    await sync(service)
    const folder = await createFolder(root, 'nova', spec('n', 'Nova', 4))
    service.onRecordingState({
      phase: 'idle',
      finished: {
        meetingId: 'n',
        folder,
        name: 'Nova',
        durationMs: 1,
        status: 'ready',
        hasVideo: false,
        reason: 'user',
        issue: null
      }
    })
    await service.settled()
    expect(await names(service)).toEqual(['Nova'])

    await createFolder(
      root,
      'nova',
      spec('n', 'Nova', 4, {
        meeting: { transcript: { status: 'running', model: 'm', updatedAt: days(4) } }
      })
    )
    service.onTranscriptChanged({
      meetingId: 'n',
      folder,
      view: {
        status: 'running',
        error: null,
        model: 'm',
        updatedAt: null,
        summaryRequested: false,
        done: 0,
        total: 3
      }
    })
    await service.settled()
    const [entry] = (await service.search(query())).entries
    expect(entry?.meeting.transcriptStatus).toBe('running')
  })

  it('ignora pastas fora da pasta das Reuniões', async () => {
    const outside = await createFolder(base, 'fora', spec('o', 'Fora', 1))
    const { service } = createService()
    await sync(service)
    await service.refresh(outside)
    expect(await names(service)).toEqual([])
  })
})

suite('busca', () => {
  async function populate(): Promise<LibraryService> {
    await createFolder(
      root,
      'planejamento',
      spec('p', 'Planejamento do trimestre', 10, {
        transcript: makeTranscript([
          { speaker: 'Maria', startMs: 61_000, text: 'Precisamos fechar o orçamento até sexta' },
          { speaker: 'João', startMs: 120_000, text: 'Concordo, o prazo é apertado' }
        ]),
        summary: makeSummary({
          overview: 'Alinhamento sobre metas e verba.',
          decisions: [{ text: 'Congelar contratações até o fim do mês', at: [300_000] }],
          actions: [{ owner: 'Ana', task: 'Enviar a planilha de custos', due: 'sexta', at: [] }]
        }),
        meeting: {
          notes: [makeNote('n1', 45_000, 'Perguntar sobre reajuste salarial')],
          transcript: { status: 'ready', model: 'm', updatedAt: days(10) },
          summary: { status: 'ready', updatedAt: days(10) }
        }
      })
    )
    await createFolder(
      root,
      'daily',
      spec('d', 'Daily', 12, {
        transcript: makeTranscript([
          { speaker: 'Pedro', startMs: 5000, text: 'Tudo certo com o deploy' }
        ])
      })
    )
    await createFolder(root, 'orcamento', spec('o', 'Orçamento 2027', 3))
    const { service } = createService()
    await sync(service)
    return service
  }

  it('acha por palavra do nome, ignorando acentos e maiúsculas', async () => {
    const service = await populate()
    expect(await names(service, { text: 'ORCAMENTO' })).toEqual([
      'Planejamento do trimestre',
      'Orçamento 2027'
    ])
    const byName = await service.search(query({ text: 'orcamento 2027' }))
    expect(byName.entries.map((entry) => entry.meeting.name)).toEqual(['Orçamento 2027'])
    expect(byName.entries[0]?.hits[0]).toMatchObject({ kind: 'name', offsetMs: null })
  })

  it('acha na Fala, com o trecho marcado, o Falante e o Instante', async () => {
    const service = await populate()
    const result = await service.search(query({ text: 'prazo' }))
    expect(result.entries).toHaveLength(1)
    const [hit] = result.entries[0]?.hits ?? []
    expect(hit).toMatchObject({ kind: 'utterance', offsetMs: 120_000 })
    expect(hit?.speaker?.map((part) => part.text).join('')).toBe('João')
    expect(hit?.parts.filter((part) => part.match).map((part) => part.text)).toEqual(['prazo'])
    expect(hit?.parts.map((part) => part.text).join('')).toBe('Concordo, o prazo é apertado')
  })

  it('acha na Anotação (Instante da Anotação) e no Resumo (primeiro Instante citado)', async () => {
    const service = await populate()
    const note = await service.search(query({ text: 'reajuste' }))
    expect(note.entries[0]?.hits[0]).toMatchObject({ kind: 'note', offsetMs: 45_000 })

    const decision = await service.search(query({ text: 'contratacoes' }))
    expect(decision.entries[0]?.hits[0]).toMatchObject({ kind: 'summary', offsetMs: 300_000 })

    const overview = await service.search(query({ text: 'metas' }))
    expect(overview.entries[0]?.hits[0]).toMatchObject({ kind: 'summary', offsetMs: null })

    const action = await service.search(query({ text: 'Ana planilha' }))
    expect(action.entries[0]?.hits[0]).toMatchObject({ kind: 'summary', offsetMs: null })
  })

  it('várias palavras precisam estar no mesmo trecho; prefixo vale', async () => {
    const service = await populate()
    expect(await names(service, { text: 'orçamento sexta' })).toEqual(['Planejamento do trimestre'])
    expect(await names(service, { text: 'orçamento deploy' })).toEqual([])
    expect(await names(service, { text: 'deplo' })).toEqual(['Daily'])
  })

  it('o nome da Reunião vem na frente de uma menção solta na relevância', async () => {
    const service = await populate()
    const result = await service.search(query({ text: 'orcamento', sort: 'relevance' }))
    expect(result.entries.map((entry) => entry.meeting.name)).toEqual([
      'Orçamento 2027',
      'Planejamento do trimestre'
    ])
  })

  it('texto com símbolos de busca não quebra nem vira operador', async () => {
    const service = await populate()
    for (const text of [
      '"',
      'orçamento AND',
      'NEAR(a b)',
      '*',
      'a:b',
      '-x',
      "d'água",
      '\\',
      '(('
    ]) {
      await expect(service.search(query({ text }))).resolves.toBeDefined()
    }
    expect((await service.search(query({ text: '***' }))).total).toBe(3)
  })

  it('sem resultado devolve vazio, mas diz que há Reuniões no índice', async () => {
    const service = await populate()
    const result = await service.search(query({ text: 'inexistente' }))
    expect(result).toMatchObject({ entries: [], total: 0, indexed: 3 })
  })

  it('filtra por intervalo de datas e combina com o texto', async () => {
    const service = await populate()
    const from = Date.parse(days(10))
    const to = Date.parse(days(12))
    expect(await names(service, { fromMs: from, toMs: to })).toEqual(['Planejamento do trimestre'])
    expect(await names(service, { fromMs: from })).toEqual(['Daily', 'Planejamento do trimestre'])
    expect(await names(service, { toMs: from })).toEqual(['Orçamento 2027'])
    expect(await names(service, { text: 'orcamento', fromMs: from })).toEqual([
      'Planejamento do trimestre'
    ])
  })

  it('ordena e limita; total conta todas as que casam', async () => {
    const service = await populate()
    expect(await names(service, { sort: 'oldest' })).toEqual([
      'Orçamento 2027',
      'Planejamento do trimestre',
      'Daily'
    ])
    const limited = await service.search(query({ limit: 2 }))
    expect(limited.entries).toHaveLength(2)
    expect(limited.total).toBe(3)
  })

  it('limita a 3 trechos por Reunião e informa quantos casaram', async () => {
    await createFolder(
      root,
      'muitos',
      spec('m', 'Muitos', 1, {
        transcript: makeTranscript(
          Array.from({ length: 6 }, (_, index) => ({
            speaker: 'Maria',
            startMs: index * 1000,
            text: `repetido número ${index}`
          }))
        )
      })
    )
    const { service } = createService()
    await sync(service)
    const [entry] = (await service.search(query({ text: 'repetido' }))).entries
    expect(entry?.hits).toHaveLength(3)
    expect(entry?.hitCount).toBe(6)
  })
})

suite('miniaturas', () => {
  it('gera a miniatura no cache do app (nunca na pasta da Reunião) e a serve pela URL', async () => {
    const folder = await createFolder(
      root,
      'a',
      spec('a', 'A', 1, { files: { 'video.mp4': 'vvvv' } })
    )
    await createFolder(root, 'sem-video', spec('b', 'B', 2))
    const { service, thumbCalls } = createService()
    await sync(service)

    expect(thumbCalls).toHaveLength(1)
    expect(thumbCalls[0]).toContain(join(folder, 'video.mp4'))
    const result = await service.search(query())
    const withVideo = result.entries.find((entry) => entry.meeting.id === 'a')?.meeting
    const withoutVideo = result.entries.find((entry) => entry.meeting.id === 'b')?.meeting
    expect(withoutVideo?.thumbnail).toBeNull()
    expect(withVideo?.hasVideo).toBe(true)
    expect(parseThumbnailUrl(withVideo?.thumbnail ?? '')).toBe('a.jpg')
    expect(await readFile(join(userData, 'thumbnails', 'a.jpg'), 'utf8')).toBe('JPEG')
    await expect(readFile(join(folder, 'a.jpg'))).rejects.toThrow()
  })

  it('só regera quando o Vídeo muda', async () => {
    const folder = await createFolder(
      root,
      'a',
      spec('a', 'A', 1, { files: { 'video.mp4': 'v1' } })
    )
    const { service, thumbCalls } = createService()
    await sync(service)
    await addMeetingNote(root, folder, { offsetMs: 1, text: 'x' })
    await service.refresh(folder)
    await service.settled()
    expect(thumbCalls).toHaveLength(1)

    await writeFile(join(folder, 'video.mp4'), 'um vídeo diferente')
    await service.refresh(folder)
    await service.settled()
    expect(thumbCalls).toHaveLength(2)
  })

  it('não gera enquanto há gravação e retoma depois', async () => {
    await createFolder(root, 'a', spec('a', 'A', 1, { files: { 'video.mp4': 'v' } }))
    const recording = { value: true }
    const { service, thumbCalls } = createService({ canMakeThumbnails: () => !recording.value })
    await sync(service)
    expect(thumbCalls).toHaveLength(0)

    recording.value = false
    service.resumeThumbnails()
    await service.settled()
    expect(thumbCalls).toHaveLength(1)
  })

  it('apagar o vídeo (ou a Reunião) remove a miniatura do cache', async () => {
    const folder = await createFolder(root, 'a', spec('a', 'A', 1, { files: { 'video.mp4': 'v' } }))
    const { service } = createService()
    await sync(service)
    const file = join(userData, 'thumbnails', 'a.jpg')
    expect(await readFile(file, 'utf8')).toBe('JPEG')

    await rm(join(folder, 'video.mp4'))
    await service.refresh(folder)
    await expect(readFile(file)).rejects.toThrow()
    expect((await service.search(query())).entries[0]?.meeting.thumbnail).toBeNull()
  })

  it('sem FFmpeg a lista funciona, só sem miniatura', async () => {
    await createFolder(root, 'a', spec('a', 'A', 1, { files: { 'video.mp4': 'v' } }))
    const { service } = createService({ getTools: () => Promise.resolve(null) })
    await sync(service)
    const [entry] = (await service.search(query())).entries
    expect(entry?.meeting).toMatchObject({ name: 'A', hasVideo: true, thumbnail: null })
  })

  it('miniatura de Reunião que sumiu é limpa do cache na varredura', async () => {
    const folder = await createFolder(root, 'a', spec('a', 'A', 1, { files: { 'video.mp4': 'v' } }))
    const { service } = createService()
    await sync(service)
    await rm(folder, { recursive: true })
    await sync(service)
    await expect(readFile(join(userData, 'thumbnails', 'a.jpg'))).rejects.toThrow()
  })
})
