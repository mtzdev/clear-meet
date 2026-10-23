import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_RULES, GROUPS_DIR, type GroupInput, type GroupRules } from '@shared/groups'
import type { FinishedRecording, RecordingState } from '@shared/recording'
import { createFolder } from '../library/fixtures'
import type { GroupStatsRow } from '../library/db'
import type { IndexedMeeting } from '../library/service'
import { listMeetingFolders, readMeeting } from '../meetings/repository'
import { GroupService } from './service'
import { GroupStore } from './store'

let base: string
let root: string
let refreshed: string[]
let changes: number
let nextId: number

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'clearmeet-group-service-'))
  root = join(base, 'Reunioes')
  await mkdir(root)
  refreshed = []
  changes = 0
  nextId = 0
})
afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

function rules(overrides: Partial<GroupRules>): GroupRules {
  return { ...EMPTY_RULES, ...overrides }
}

/** Lê as pastas como o índice faria (já descartando `groupId` de grupo que não existe). */
async function indexed(store: GroupStore): Promise<IndexedMeeting[]> {
  const valid = new Set(await store.ids())
  const found: IndexedMeeting[] = []
  for (const folder of await listMeetingFolders(root)) {
    const read = await readMeeting(folder)
    if (!read.ok) continue
    const meeting = read.value
    found.push({
      id: meeting.id,
      folder,
      name: meeting.name,
      createdAt: meeting.createdAt,
      status: meeting.status,
      durationMs: meeting.durationMs,
      sourceKind: meeting.source.kind,
      sourceName: meeting.source.name,
      tags: meeting.tags ?? [],
      groupId: meeting.groupId && valid.has(meeting.groupId) ? meeting.groupId : null
    })
  }
  return found
}

async function stats(store: GroupStore): Promise<Map<string, GroupStatsRow>> {
  const result = new Map<string, GroupStatsRow>()
  for (const meeting of await indexed(store)) {
    if (!meeting.groupId) continue
    const row = result.get(meeting.groupId) ?? { count: 0, totalDurationMs: 0, lastMs: 0 }
    row.count += 1
    row.totalDurationMs += meeting.durationMs ?? 0
    row.lastMs = Math.max(row.lastMs, Date.parse(meeting.createdAt))
    result.set(meeting.groupId, row)
  }
  return result
}

interface Harness {
  service: GroupService
  store: GroupStore
}

function createService(onDeleted?: (id: string) => Promise<void>): Harness {
  const store = new GroupStore(() => root)
  const service = new GroupService({
    store,
    ...(onDeleted ? { onDeleted } : {}),
    meetingsDir: () => root,
    meetings: () => indexed(store),
    stats: () => stats(store),
    refresh: (folder) => {
      refreshed.push(folder)
      return Promise.resolve()
    },
    emitChanged: () => {
      changes++
    },
    newId: () => `g${++nextId}`,
    now: () => Date.parse('2026-10-21T12:00:00Z'),
    log: () => undefined
  })
  return { service, store }
}

interface Spec {
  tags?: string[]
  groupId?: string
  status?: 'ready' | 'recording' | 'processing'
  createdAt?: string
  durationMs?: number
}

function meetingFolder(name: string, spec: Spec = {}): Promise<string> {
  return createFolder(root, name, {
    meeting: {
      id: name,
      name,
      ...(spec.tags ? { tags: spec.tags } : {}),
      ...(spec.groupId ? { groupId: spec.groupId } : {}),
      ...(spec.status ? { status: spec.status } : {}),
      ...(spec.createdAt ? { createdAt: spec.createdAt } : {}),
      ...(spec.durationMs !== undefined ? { durationMs: spec.durationMs } : {})
    }
  })
}

async function groupOf(folder: string): Promise<string | undefined> {
  const read = await readMeeting(folder)
  if (!read.ok) throw new Error(read.error)
  return read.value.groupId
}

function groupInput(name: string, groupRules: GroupRules | null = null): GroupInput {
  return { name, description: '', rules: groupRules }
}

describe('criar, editar e apagar', () => {
  it('cria um grupo manual, trata o nome e recusa nome repetido', async () => {
    const { service } = createService()
    const made = await service.create(
      { name: '  Daily  ', description: 'time', rules: null },
      false
    )
    expect(made).toMatchObject({
      ok: true,
      value: { applied: 0, group: { id: 'g1', name: 'Daily', description: 'time', rules: null } }
    })
    const overview = await service.overview()
    expect(overview.groups.map((group) => group.name)).toEqual(['Daily'])
    expect(changes).toBeGreaterThan(0)

    const repeated = await service.create(groupInput('daily'), false)
    expect(repeated).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect((await service.create(groupInput('  '), false)).ok).toBe(false)
    expect((await service.overview()).groups).toHaveLength(1)
  })

  it('grupo automático com "aplicar" pega só as Reuniões prontas e sem grupo', async () => {
    const { service } = createService()
    const a = await meetingFolder('Daily 1', { tags: ['Daily'] })
    const b = await meetingFolder('Daily 2', { tags: ['Daily'] })
    const other = await meetingFolder('Outra', { tags: ['Weekly'] })
    const recording = await meetingFolder('Daily 3', { tags: ['Daily'], status: 'recording' })
    const manual = await service.create(groupInput('Escolhido'), false)
    if (!manual.ok) throw new Error('falhou')
    const picked = await meetingFolder('Daily 4', {
      tags: ['Daily'],
      groupId: manual.value.group.id
    })

    const result = await service.create(groupInput('Dailies', rules({ tag: 'Daily' })), true)
    expect(result).toMatchObject({ ok: true, value: { applied: 2 } })
    const id = result.ok ? result.value.group.id : ''
    expect(await groupOf(a)).toBe(id)
    expect(await groupOf(b)).toBe(id)
    expect(await groupOf(other)).toBeUndefined()
    expect(await groupOf(recording)).toBeUndefined()
    // Escolhida à mão: a regra nunca tira de lá.
    expect(await groupOf(picked)).toBe(manual.value.group.id)
    expect(refreshed).toContain(a)
  })

  it('sem "aplicar", criar o grupo não mexe nas Reuniões existentes', async () => {
    const { service } = createService()
    const a = await meetingFolder('Daily 1', { tags: ['Daily'] })
    const result = await service.create(groupInput('Dailies', rules({ tag: 'Daily' })), false)
    expect(result).toMatchObject({ ok: true, value: { applied: 0 } })
    expect(await groupOf(a)).toBeUndefined()
  })

  it('a ordem dos grupos é a prioridade ao aplicar as regras', async () => {
    const { service } = createService()
    const a = await meetingFolder('Daily 1', { tags: ['Daily'] })
    const first = await service.create(groupInput('Primeiro', rules({ tag: 'Daily' })), false)
    const second = await service.create(
      groupInput('Segundo', rules({ nameContains: 'daily' })),
      true
    )
    if (!first.ok || !second.ok) throw new Error('falhou')
    // O segundo grupo não rouba o que o primeiro (que vem antes) pegaria.
    expect(second.value.applied).toBe(0)
    expect(await groupOf(a)).toBeUndefined()

    const reordered = await service.reorder([second.value.group.id, first.value.group.id])
    expect(reordered.ok).toBe(true)
    const again = await service.update(
      second.value.group.id,
      groupInput('Segundo', rules({ nameContains: 'daily' })),
      true
    )
    expect(again).toMatchObject({ ok: true, value: { applied: 1 } })
    expect(await groupOf(a)).toBe(second.value.group.id)
  })

  it('edita nome, descrição e regras; recusa nome de outro grupo e grupo inexistente', async () => {
    const { service } = createService()
    const a = await service.create(groupInput('A'), false)
    const b = await service.create(groupInput('B'), false)
    if (!a.ok || !b.ok) throw new Error('falhou')
    const edited = await service.update(
      a.value.group.id,
      { name: 'A2', description: 'nova', rules: rules({ tag: 'X' }) },
      false
    )
    expect(edited).toMatchObject({
      ok: true,
      value: { group: { name: 'A2', description: 'nova', rules: rules({ tag: 'X' }) } }
    })
    expect(await service.update(a.value.group.id, groupInput('b'), false)).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })
    expect(await service.update('nao-existe', groupInput('Z'), false)).toMatchObject({
      ok: false,
      error: { code: 'not-found' }
    })
    // Voltar a manual mantém as Reuniões.
    const manual = await service.update(a.value.group.id, groupInput('A2'), false)
    expect(manual).toMatchObject({ ok: true, value: { group: { rules: null } } })
  })

  it('apagar o grupo deixa as Reuniões sem grupo e não apaga nenhuma', async () => {
    const { service } = createService()
    const made = await service.create(groupInput('Daily'), false)
    const keep = await service.create(groupInput('Outro'), false)
    if (!made.ok || !keep.ok) throw new Error('falhou')
    const a = await meetingFolder('A', { groupId: made.value.group.id })
    const b = await meetingFolder('B', { groupId: made.value.group.id })
    const c = await meetingFolder('C', { groupId: keep.value.group.id })

    const result = await service.delete(made.value.group.id)
    expect(result).toEqual({ ok: true, value: { updated: 2 } })
    expect(await groupOf(a)).toBeUndefined()
    expect(await groupOf(b)).toBeUndefined()
    expect(await groupOf(c)).toBe(keep.value.group.id)
    expect((await listMeetingFolders(root)).length).toBe(3)
    expect((await service.overview()).groups.map((group) => group.id)).toEqual([
      keep.value.group.id
    ])
    expect(await service.delete('nao-existe')).toMatchObject({ ok: false })
  })

  it('apagar o grupo avisa para a Conversa dele ir junto, e recusar não avisa', async () => {
    const deleted: string[] = []
    const { service } = createService((id) => {
      deleted.push(id)
      return Promise.resolve()
    })
    const made = await service.create(groupInput('Daily'), false)
    const busy = await service.create(groupInput('Ocupado'), false)
    if (!made.ok || !busy.ok) throw new Error('falhou')
    await meetingFolder('B', { groupId: busy.value.group.id, status: 'recording' })
    expect((await service.delete(busy.value.group.id)).ok).toBe(false)
    expect(deleted).toEqual([])
    expect((await service.delete(made.value.group.id)).ok).toBe(true)
    expect(deleted).toEqual([made.value.group.id])
  })

  it('falha ao apagar a Conversa não impede apagar o grupo', async () => {
    const { service } = createService(() => Promise.reject(new Error('sem permissão')))
    const made = await service.create(groupInput('Daily'), false)
    if (!made.ok) throw new Error('falhou')
    expect((await service.delete(made.value.group.id)).ok).toBe(true)
    expect((await service.overview()).groups).toEqual([])
  })

  it('apagar é recusado se uma Reunião do grupo ainda grava, e nada muda', async () => {
    const { service } = createService()
    const made = await service.create(groupInput('Daily'), false)
    if (!made.ok) throw new Error('falhou')
    const ready = await meetingFolder('A', { groupId: made.value.group.id })
    await meetingFolder('B', { groupId: made.value.group.id, status: 'recording' })
    const result = await service.delete(made.value.group.id)
    expect(result).toMatchObject({ ok: false, error: { code: 'busy' } })
    expect((await service.overview()).groups).toHaveLength(1)
    expect(await groupOf(ready)).toBe(made.value.group.id)
  })

  it('reordena os grupos', async () => {
    const { service } = createService()
    const a = await service.create(groupInput('A'), false)
    const b = await service.create(groupInput('B'), false)
    if (!a.ok || !b.ok) throw new Error('falhou')
    expect((await service.reorder([b.value.group.id, a.value.group.id])).ok).toBe(true)
    expect((await service.overview()).groups.map((group) => group.name)).toEqual(['B', 'A'])
    expect((await service.reorder('x' as unknown as string[])).ok).toBe(false)
  })
})

describe('mover Reuniões', () => {
  it('põe várias Reuniões no grupo, troca o grupo que tinham e tira do grupo', async () => {
    const { service } = createService()
    const one = await service.create(groupInput('Um'), false)
    const two = await service.create(groupInput('Dois'), false)
    if (!one.ok || !two.ok) throw new Error('falhou')
    const folders = await Promise.all(['A', 'B', 'C'].map((name) => meetingFolder(name)))

    expect(await service.setGroup(folders, one.value.group.id)).toEqual({
      ok: true,
      value: { updated: 3 }
    })
    for (const folder of folders) expect(await groupOf(folder)).toBe(one.value.group.id)

    // Um grupo só por Reunião: mover substitui.
    expect((await service.setGroup([folders[0] as string], two.value.group.id)).ok).toBe(true)
    expect(await groupOf(folders[0] as string)).toBe(two.value.group.id)
    expect(await groupOf(folders[1] as string)).toBe(one.value.group.id)

    expect((await service.setGroup(folders, null)).ok).toBe(true)
    for (const folder of folders) expect(await groupOf(folder)).toBeUndefined()
    const overview = await service.overview()
    expect(overview.groups.map((group) => group.count)).toEqual([0, 0])
  })

  it('recusa o lote inteiro se alguma Reunião grava ou processa', async () => {
    const { service } = createService()
    const made = await service.create(groupInput('Daily'), false)
    if (!made.ok) throw new Error('falhou')
    const ready = await meetingFolder('A')
    const recording = await meetingFolder('B', { status: 'recording' })
    const processing = await meetingFolder('C', { status: 'processing' })
    for (const busy of [recording, processing]) {
      const result = await service.setGroup([ready, busy], made.value.group.id)
      expect(result).toMatchObject({ ok: false, error: { code: 'busy' } })
    }
    expect(await groupOf(ready)).toBeUndefined()
  })

  it('recusa grupo que não existe, pedido vazio e pasta fora da pasta das Reuniões', async () => {
    const { service } = createService()
    const folder = await meetingFolder('A')
    expect(await service.setGroup([folder], 'nao-existe')).toMatchObject({
      ok: false,
      error: { code: 'not-found' }
    })
    expect((await service.setGroup([], null)).ok).toBe(false)
    expect((await service.setGroup(['C:\\outra\\pasta'], null)).ok).toBe(false)
    expect((await service.setGroup(null, null)).ok).toBe(false)
  })
})

describe('Reunião nova', () => {
  it('entra no primeiro grupo automático que combina', async () => {
    const { service } = createService()
    await service.create(groupInput('Manual'), false)
    const weekly = await service.create(
      groupInput('Weekly', rules({ nameContains: 'weekly' })),
      false
    )
    const daily = await service.create(groupInput('Daily', rules({ tag: 'Daily' })), false)
    if (!weekly.ok || !daily.ok) throw new Error('falhou')
    const folder = await meetingFolder('Weekly 21-10', { tags: ['Daily'] })
    const result = await service.autoAssign(folder)
    expect(result).toEqual({ ok: true, value: { groupId: weekly.value.group.id } })
    expect(await groupOf(folder)).toBe(weekly.value.group.id)
    expect(refreshed).toContain(folder)
  })

  it('sem regra que combine, fica sem grupo e o arquivo não é reescrito', async () => {
    const { service } = createService()
    await service.create(groupInput('Daily', rules({ tag: 'Daily' })), false)
    const folder = await meetingFolder('Outra')
    expect(await service.autoAssign(folder)).toEqual({ ok: true, value: { groupId: null } })
    expect(await groupOf(folder)).toBeUndefined()
  })

  it('nunca tira a Reunião de um grupo escolhido à mão', async () => {
    const { service } = createService()
    const manual = await service.create(groupInput('Escolhido'), false)
    await service.create(groupInput('Daily', rules({ tag: 'Daily' })), false)
    if (!manual.ok) throw new Error('falhou')
    const folder = await meetingFolder('Daily 1', {
      tags: ['Daily'],
      groupId: manual.value.group.id
    })
    expect(await service.autoAssign(folder)).toEqual({
      ok: true,
      value: { groupId: manual.value.group.id }
    })
    expect(await groupOf(folder)).toBe(manual.value.group.id)
  })

  it('um groupId de grupo que não existe mais conta como sem grupo', async () => {
    const { service } = createService()
    const daily = await service.create(groupInput('Daily', rules({ tag: 'Daily' })), false)
    if (!daily.ok) throw new Error('falhou')
    const folder = await meetingFolder('Daily 1', { tags: ['Daily'], groupId: 'apagado' })
    const result = await service.autoAssign(folder)
    expect(result).toEqual({ ok: true, value: { groupId: daily.value.group.id } })
    const stale = await meetingFolder('Outra', { groupId: 'apagado' })
    expect(await service.autoAssign(stale)).toEqual({ ok: true, value: { groupId: null } })
  })

  it('Reunião ainda gravando ou processando não é tocada', async () => {
    const { service } = createService()
    await service.create(groupInput('Daily', rules({ tag: 'Daily' })), false)
    const folder = await meetingFolder('Daily 1', { tags: ['Daily'], status: 'processing' })
    expect(await service.autoAssign(folder)).toMatchObject({ ok: false, error: { code: 'busy' } })
    expect(await groupOf(folder)).toBeUndefined()
  })

  it('ao fim da gravação, a Reunião finalizada entra no grupo; sem arquivos finais, espera', async () => {
    const { service } = createService()
    const daily = await service.create(groupInput('Daily', rules({ nameContains: 'daily' })), false)
    if (!daily.ok) throw new Error('falhou')
    const finished = (folder: string, status: FinishedRecording['status']): RecordingState => ({
      phase: 'idle',
      finished: {
        meetingId: folder,
        folder,
        name: 'Daily',
        durationMs: 1000,
        status,
        hasVideo: true,
        hasAudioInput: true,
        reason: 'user',
        issue: null
      }
    })
    const folder = await meetingFolder('Daily 21-10')
    service.onRecordingState({ phase: 'starting' })
    service.onRecordingState(finished(folder, 'ready'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await groupOf(folder)).toBe(daily.value.group.id)

    const pending = await meetingFolder('Daily 22-10', { status: 'processing' })
    service.onRecordingState({ phase: 'starting' })
    service.onRecordingState(finished(pending, 'unprocessed'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await groupOf(pending)).toBeUndefined()
  })
})

describe('visão geral', () => {
  it('traz contagem, duração total e a última Reunião de cada grupo', async () => {
    const { service } = createService()
    const made = await service.create(groupInput('Daily'), false)
    if (!made.ok) throw new Error('falhou')
    const id = made.value.group.id
    await meetingFolder('A', {
      groupId: id,
      createdAt: '2026-10-10T12:00:00.000Z',
      durationMs: 60_000
    })
    await meetingFolder('B', {
      groupId: id,
      createdAt: '2026-10-12T12:00:00.000Z',
      durationMs: 120_000
    })
    await meetingFolder('C', { createdAt: '2026-10-13T12:00:00.000Z' })
    await meetingFolder('D', { status: 'recording' })

    const overview = await service.overview()
    expect(overview.editable).toBe(true)
    expect(overview.groups[0]).toMatchObject({
      id,
      count: 2,
      totalDurationMs: 180_000,
      lastMeetingAt: '2026-10-12T12:00:00.000Z'
    })
    // Só as prontas contam como "sem grupo".
    expect(overview.ungroupedCount).toBe(1)
  })

  it('pasta ilegível: grupos indisponíveis, sem lançar', async () => {
    const { service } = createService()
    await mkdir(join(root, GROUPS_DIR, 'groups.json'), { recursive: true })
    const overview = await service.overview()
    expect(overview).toMatchObject({ editable: false, groups: [], suggestions: [] })
    expect(overview.message).toBeTruthy()
  })

  it('pasta que não aceita gravar: a alteração falha com mensagem e as sugestões somem', async () => {
    const { service } = createService()
    await writeFile(join(root, GROUPS_DIR), 'bloqueio')
    const failed = await service.create(groupInput('Daily'), false)
    expect(failed).toMatchObject({ ok: false, error: { code: 'unknown' } })
    const overview = await service.overview()
    expect(overview.editable).toBe(false)
    expect(overview.message).toBeTruthy()
    expect(overview.suggestions).toEqual([])
  })
})

describe('prévia', () => {
  it('conta as Reuniões sem grupo que entrariam, respeitando a prioridade', async () => {
    const { service } = createService()
    await meetingFolder('Daily 1', { tags: ['Daily'] })
    await meetingFolder('Daily 2', { tags: ['Daily'] })
    await meetingFolder('Outra')
    expect(await service.preview({ tag: 'Daily' }, null)).toEqual({ matching: 2 })
    expect(await service.preview({}, null)).toEqual({ matching: 0 })

    const first = await service.create(groupInput('Primeiro', rules({ tag: 'Daily' })), false)
    if (!first.ok) throw new Error('falhou')
    // Um grupo novo vai para o fim: o primeiro já tem prioridade sobre as duas Reuniões.
    expect(await service.preview({ nameContains: 'daily' }, null)).toEqual({ matching: 0 })
    // Editando o próprio primeiro grupo, ele continua na frente.
    expect(await service.preview({ nameContains: 'daily' }, first.value.group.id)).toEqual({
      matching: 2
    })
  })
})

describe('sugestões', () => {
  function dailies(): Promise<string[]> {
    return Promise.all(
      [10, 11, 12, 13].map((day) =>
        meetingFolder(`Daily ${day}-10`, { createdAt: `2026-10-${day}T12:00:00.000Z` })
      )
    )
  }

  it('sugere séries sem grupo e aceitar cria o grupo e põe as Reuniões nele', async () => {
    const { service } = createService()
    const folders = await dailies()
    const overview = await service.overview()
    expect(overview.suggestions).toHaveLength(1)
    expect(overview.suggestions[0]).toMatchObject({ id: 'name:daily', name: 'Daily', count: 4 })

    const accepted = await service.acceptSuggestion('name:daily')
    expect(accepted).toMatchObject({ ok: true, value: { applied: 4, group: { name: 'Daily' } } })
    const id = accepted.ok ? accepted.value.group.id : ''
    for (const folder of folders) expect(await groupOf(folder)).toBe(id)
    expect((await service.overview()).suggestions).toEqual([])
    expect(await service.acceptSuggestion('name:daily')).toMatchObject({
      ok: false,
      error: { code: 'not-found' }
    })
  })

  it('dispensar persiste, também depois de reabrir o app', async () => {
    const { service } = createService()
    await dailies()
    const ids = async (target: GroupService): Promise<string[]> =>
      (await target.overview()).suggestions.map((item) => item.id)
    // A mesma série também aparece pelo aplicativo (todas as Reuniões foram em "Zoom").
    expect(await ids(service)).toEqual(['name:daily'])
    expect((await service.dismissSuggestion('name:daily')).ok).toBe(true)
    expect(await ids(service)).toEqual(['source:zoom'])
    const reopened = createService().service
    expect(await ids(reopened)).toEqual(['source:zoom'])
    expect((await reopened.dismissSuggestion('source:zoom')).ok).toBe(true)
    expect(await ids(createService().service)).toEqual([])
    expect((await service.dismissSuggestion('')).ok).toBe(false)
  })

  it('Reuniões que já caem nas regras de um grupo não viram sugestão', async () => {
    const { service } = createService()
    await service.create(groupInput('Séries', rules({ nameContains: 'daily' })), false)
    await dailies()
    expect((await service.overview()).suggestions).toEqual([])
  })
})
