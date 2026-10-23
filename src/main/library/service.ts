import { stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import {
  isLibrarySort,
  type LibraryEntry,
  type LibraryQuery,
  type LibraryResult,
  type MeetingListItem,
  type SearchHit
} from '@shared/library'
import type { MeetingRelevance, ScopeCandidate } from '@shared/group-chat'
import type { SuggestionSubject } from '@shared/group-suggestions'
import { UNGROUPED_FILTER } from '@shared/groups'
import {
  MEETING_FILE,
  MEETING_FILES,
  meetingTags,
  type MeetingNote,
  type MeetingStatus
} from '@shared/meeting'
import { thumbnailUrl } from '@shared/media'
import type { RecordingState } from '@shared/recording'
import { buildFtsQuery, makeSnippet, searchTokens } from '@shared/search'
import { tagKey, type TagInfo } from '@shared/tags'
import type { SummaryChangedEvent } from '@shared/summary'
import type { TranscriptChangedEvent } from '@shared/transcript'
import type { FfmpegTools, RunProcess } from '../ffmpeg/media'
import { sameFolder } from '../meetings/paths'
import { findMeetingFolder } from '../meetings/library'
import { isDirectChild, readMeeting } from '../meetings/repository'
import { readSummary } from '../meetings/summary-store'
import { readTranscript } from '../meetings/transcript-store'
import {
  openLibraryDb,
  type GroupFilter,
  type GroupStatsRow,
  type LibraryDb,
  type StoredMeeting
} from './db'
import { buildFragments, buildRow } from './extract'
import { listFolderNames, scanFolder } from './scan'
import type { SqliteModule } from './sqlite'
import {
  removeOrphanThumbnails,
  removeThumbnail,
  ThumbnailQueue,
  type ThumbnailJob
} from './thumbnails'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 500
const HITS_PER_MEETING = 3
const SCAN_BATCH = 16
/** Reconciliações pedidas em intervalo menor que este (foco da janela, abrir a tela) são ignoradas. */
const MIN_RECONCILE_INTERVAL_MS = 3000
/** Marca de pasta repetida: nunca igual a uma assinatura real, então é relida a cada varredura. */
const DUPLICATE_MARK = 'duplicate'

export interface LibraryServiceDeps {
  /** Caminho do arquivo do índice (ou `:memory:`). */
  dbPath: string
  /** Pasta do cache de miniaturas. */
  thumbnailsDir: string
  meetingsDir(): string
  activeFolder(): string | null
  /** Ids dos grupos que existem agora (um `groupId` fora desta lista conta como sem grupo). */
  groupIds(): Promise<readonly string[]>
  loadSqlite(): Promise<SqliteModule>
  getTools(): Promise<FfmpegTools | null>
  /** Falso enquanto há gravação (a máquina é dela). */
  canMakeThumbnails(): boolean
  /** O índice mudou: as telas devem consultar de novo. */
  emitChanged(): void
  run?: RunProcess
  now(): number
  log(message: string): void
}

const UNAVAILABLE = 'Não foi possível abrir o índice das Reuniões.'

/** Uma Reunião de um grupo para o escopo das perguntas, com a pasta onde ela está. */
export interface GroupMeetingRef extends ScopeCandidate {
  folder: string
}

/** Trechos considerados ao medir quanto uma Reunião casa com uma pergunta. */
const RELEVANCE_HITS = 12
const RELEVANCE_SCORED_HITS = 3
/** Reuniões de um grupo oferecidas no escopo das perguntas (as mais recentes). */
const GROUP_MEETINGS_LIMIT = 300

/** Uma Reunião do índice com o que os grupos precisam dela. */
export interface IndexedMeeting extends SuggestionSubject {
  folder: string
  status: MeetingStatus
  durationMs: number | null
  /** Já só com grupos que existem. */
  groupId: string | null
}

function clampLimit(limit: number | null): number {
  if (limit === null || !Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT)
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** O pedido vem da UI: confere a forma antes de consultar. */
export function normalizeQuery(query: LibraryQuery): {
  text: string
  tagKeys: string[]
  groupId: string | null
  fromMs: number | null
  toMs: number | null
  sort: LibraryQuery['sort']
  limit: number
} {
  return {
    text: typeof query.text === 'string' ? query.text.slice(0, 200) : '',
    tagKeys: Array.isArray(query.tags)
      ? [...new Set(query.tags.filter((tag) => typeof tag === 'string').map(tagKey))]
      : [],
    groupId:
      typeof query.groupId === 'string' && query.groupId !== ''
        ? query.groupId.slice(0, 100)
        : null,
    fromMs: finiteOrNull(query.fromMs),
    toMs: finiteOrNull(query.toMs),
    sort: isLibrarySort(query.sort) ? query.sort : 'newest',
    limit: clampLimit(finiteOrNull(query.limit))
  }
}

function rootKey(root: string): string {
  const resolved = resolve(root)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * Biblioteca: o índice SQLite das Reuniões (lista, busca e miniaturas). A pasta de cada
 * Reunião é a fonte da verdade; o índice é descartável e se refaz varrendo as pastas.
 * Todas as escritas no índice passam por uma fila, então leituras de arquivo atrasadas
 * nunca sobrescrevem um estado mais novo.
 */
export class LibraryService {
  private opening: Promise<LibraryDb | null> | null = null
  private db: LibraryDb | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private reconciling: Promise<void> | null = null
  private reconcileAgain = false
  private lastReconcileAt = 0
  private updating = false
  private paused = false
  private lastPhase: RecordingState['phase'] | null = null
  private readonly aiStatus = new Map<string, string>()
  private readonly thumbnails: ThumbnailQueue

  constructor(private readonly deps: LibraryServiceDeps) {
    this.thumbnails = new ThumbnailQueue({
      dir: deps.thumbnailsDir,
      getTools: () => deps.getTools(),
      canRun: () => deps.canMakeThumbnails() && !this.paused,
      ...(deps.run ? { run: deps.run } : {}),
      log: (message) => deps.log(message),
      onDone: (job, outcome) => {
        this.db?.setThumbnail(job.id, job.videoSig, outcome === 'ok', deps.now())
        deps.emitChanged()
      }
    })
  }

  private open(): Promise<LibraryDb | null> {
    this.opening ??= (async () => {
      try {
        const sqlite = await this.deps.loadSqlite()
        this.db = openLibraryDb(sqlite, this.deps.dbPath, (message) => this.deps.log(message))
        return this.db
      } catch (error) {
        this.deps.log(
          `[library] não foi possível abrir o índice: ${error instanceof Error ? error.message : String(error)}`
        )
        return null
      }
    })()
    return this.opening
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task)
    this.chain = run.catch(() => undefined)
    return run
  }

  /** Abre o índice e o atualiza em segundo plano. */
  start(): void {
    void this.reconcile({ force: true })
  }

  /**
   * Suspende varreduras, atualizações e miniaturas e espera a que estiver em curso largar os
   * arquivos (para as pastas poderem ser movidas). `resume()` retoma e relê tudo.
   */
  async pause(): Promise<void> {
    this.paused = true
    await this.reconciling
    await this.chain
    await this.thumbnails.idle()
  }

  resume(): void {
    this.paused = false
    this.thumbnails.kick()
    void this.reconcile({ force: true })
  }

  isUpdating(): boolean {
    return this.updating
  }

  /** Espera as atualizações e as miniaturas pendentes terminarem (para os testes). */
  async settled(): Promise<void> {
    await this.reconciling
    await this.chain
    await this.thumbnails.idle()
    await this.chain
  }

  async close(): Promise<void> {
    await this.chain
    const db = await this.opening
    db?.close()
    this.db = null
    this.opening = null
  }

  // --- Leitura --------------------------------------------------------------------------------

  async search(input: LibraryQuery): Promise<LibraryResult> {
    const db = await this.open()
    if (!db) throw new Error(UNAVAILABLE)
    const query = normalizeQuery(input)
    const root = this.deps.meetingsDir()
    const active = this.deps.activeFolder()
    const fts = buildFtsQuery(query.text)
    const tokens = searchTokens(query.text)
    const validGroups = await this.deps.groupIds()
    const group: GroupFilter | null =
      query.groupId === null
        ? null
        : query.groupId === UNGROUPED_FILTER
          ? { kind: 'none', validIds: validGroups }
          : { kind: 'id', id: query.groupId }
    const { rows, total } = db.query({
      fts,
      fromMs: query.fromMs,
      toMs: query.toMs,
      tagKeys: query.tagKeys,
      group,
      sort: query.sort,
      limit: query.limit
    })
    const tags = db.tagsFor(rows.map((row) => row.id))
    const hits = fts
      ? db.hits(
          fts,
          rows.map((row) => row.id),
          HITS_PER_MEETING
        )
      : null
    const entries: LibraryEntry[] = rows.map((row) => {
      const found = hits?.get(row.id)
      const searchHits: SearchHit[] = (found?.hits ?? []).map((hit) => ({
        kind: hit.kind,
        offsetMs: hit.offsetMs,
        speaker: hit.speaker ? makeSnippet(hit.speaker, tokens, 80) : null,
        parts: makeSnippet(hit.body, tokens)
      }))
      return {
        meeting: toItem(row, root, active, tags.get(row.id) ?? [], validGroups),
        hits: searchHits,
        hitCount: found?.total ?? 0
      }
    })
    return {
      entries,
      total,
      indexed: db.count(),
      skipped: db.skippedCount(),
      updating: this.updating
    }
  }

  /** Todas as Reuniões iniciadas antes de `cutoffMs`, da mais antiga à mais nova (Limpeza). */
  async olderThan(cutoffMs: number): Promise<MeetingListItem[]> {
    const db = await this.open()
    if (!db) throw new Error(UNAVAILABLE)
    const root = this.deps.meetingsDir()
    const active = this.deps.activeFolder()
    const { rows } = db.query({
      fts: null,
      fromMs: null,
      toMs: cutoffMs,
      tagKeys: [],
      group: null,
      sort: 'oldest',
      limit: Number.MAX_SAFE_INTEGER
    })
    const tags = db.tagsFor(rows.map((row) => row.id))
    const validGroups = await this.deps.groupIds()
    return rows.map((row) => toItem(row, root, active, tags.get(row.id) ?? [], validGroups))
  }

  /** Tags usadas pelas Reuniões do índice, com a contagem de cada uma. */
  async tagCounts(): Promise<TagInfo[]> {
    const db = await this.open()
    return db ? db.tagCounts() : []
  }

  /** Contagem, duração total e última Reunião de cada grupo (só os que têm Reuniões). */
  async groupStats(): Promise<Map<string, GroupStatsRow>> {
    const db = await this.open()
    return db ? db.groupStats() : new Map()
  }

  /** Todas as Reuniões do índice com o que as regras dos grupos enxergam delas. */
  async indexedMeetings(): Promise<IndexedMeeting[]> {
    const db = await this.open()
    if (!db) return []
    const root = this.deps.meetingsDir()
    const rows = db.groupSubjects()
    const tags = db.tagsFor(rows.map((row) => row.id))
    const valid = new Set(await this.deps.groupIds())
    return rows.map((row) => ({
      id: row.id,
      folder: join(root, row.folderName),
      name: row.name,
      createdAt: row.createdAt,
      status: row.status,
      durationMs: row.durationMs,
      sourceKind: row.sourceKind,
      sourceName: row.sourceName,
      tags: tags.get(row.id) ?? [],
      groupId: row.groupId !== null && valid.has(row.groupId) ? row.groupId : null
    }))
  }

  /** Reuniões do grupo, da mais recente para a mais antiga, com a situação da Transcrição. */
  async groupMeetings(groupId: string): Promise<GroupMeetingRef[]> {
    const db = await this.open()
    if (!db) return []
    const root = this.deps.meetingsDir()
    const { rows } = db.query({
      fts: null,
      fromMs: null,
      toMs: null,
      tagKeys: [],
      group: { kind: 'id', id: groupId },
      sort: 'newest',
      limit: GROUP_MEETINGS_LIMIT
    })
    return rows.map((row) => ({
      id: row.id,
      folder: join(root, row.folderName),
      name: row.name,
      createdAt: row.createdAt,
      durationMs: row.durationMs,
      hasTranscript: row.status === 'ready' && row.transcriptStatus === 'ready'
    }))
  }

  /**
   * Quanto cada Reunião casa com a busca `fts` (qualquer palavra) e em que Instantes, pelo
   * ranking do FTS5 existente. Reunião sem nenhum trecho que case fica de fora do resultado.
   */
  async relevanceFor(
    meetingIds: readonly string[],
    fts: string
  ): Promise<Map<string, MeetingRelevance>> {
    const db = await this.open()
    const found = new Map<string, MeetingRelevance>()
    if (!db) return found
    const scores = new Map<string, number[]>()
    for (const row of db.relevance(fts, meetingIds, RELEVANCE_HITS)) {
      const entry = found.get(row.meetingId) ?? { score: 0, offsets: [] }
      const ranks = scores.get(row.meetingId) ?? []
      if (ranks.length < RELEVANCE_SCORED_HITS) {
        ranks.push(row.rank)
        entry.score = -ranks.reduce((sum, rank) => sum + rank, 0)
      }
      scores.set(row.meetingId, ranks)
      if (row.offsetMs !== null) (entry.offsets as number[]).push(row.offsetMs)
      found.set(row.meetingId, entry)
    }
    return found
  }

  /**
   * Pasta da Reunião `id`. O índice responde na hora; se a pasta sumiu ou mudou de dono, varre
   * as pastas (a fonte da verdade) antes de desistir.
   */
  async folderFor(id: string): Promise<string | null> {
    const root = this.deps.meetingsDir()
    const db = await this.open()
    const stored = db?.find(id)
    if (stored) {
      const folder = join(root, stored.folderName)
      const read = await readMeeting(folder)
      if (read.ok && read.value.id === id) return folder
    }
    return findMeetingFolder(root, id)
  }

  /** Anotações da Reunião `id`, lidas do `meeting.json` (a verdade); `null` se ela não existe mais. */
  async notesFor(id: string): Promise<MeetingNote[] | null> {
    const folder = await this.folderFor(id)
    if (!folder) return null
    const read = await readMeeting(folder)
    return read.ok && read.value.id === id ? read.value.notes : null
  }

  // --- Atualização ----------------------------------------------------------------------------

  /** Reconcilia o índice com as pastas. Chamadas simultâneas se juntam; `force` ignora o intervalo mínimo. */
  reconcile(options: { force?: boolean } = {}): Promise<void> {
    if (this.paused) return Promise.resolve()
    if (this.reconciling) {
      this.reconcileAgain = true
      return this.reconciling
    }
    if (!options.force && this.deps.now() - this.lastReconcileAt < MIN_RECONCILE_INTERVAL_MS) {
      return Promise.resolve()
    }
    this.reconciling = this.runReconcile().finally(() => {
      this.reconciling = null
      this.lastReconcileAt = this.deps.now()
      if (this.reconcileAgain) {
        this.reconcileAgain = false
        void this.reconcile({ force: true })
      }
    })
    return this.reconciling
  }

  private async runReconcile(): Promise<void> {
    const db = await this.open()
    if (!db) return
    this.updating = true
    try {
      const root = this.deps.meetingsDir()
      await this.enqueue(() => this.ensureRoot(db, root))

      const names = await listFolderNames(root)
      const present = new Set(names.map((name) => name.toLowerCase()))
      const indexed = db.indexedFolders()
      const skipped = db.skippedFolders()

      for (const [key, entry] of indexed) {
        if (present.has(key)) continue
        await this.enqueue(() => this.forget(db, entry.folderName))
      }
      for (const key of skipped.keys()) {
        if (!present.has(key)) db.remove(key)
      }

      for (let from = 0; from < names.length; from += SCAN_BATCH) {
        const batch = names.slice(from, from + SCAN_BATCH)
        const scans = await Promise.all(batch.map((name) => scanFolder(join(root, name))))
        let changed = false
        for (const [index, name] of batch.entries()) {
          const scan = scans[index]
          if (!scan) continue
          const key = name.toLowerCase()
          if (indexed.get(key)?.signature === scan.signature) continue
          if (skipped.get(key) === scan.signature) continue
          const did = await this.enqueue(() => this.indexFolder(db, root, name))
          changed = changed || did
        }
        if (changed) this.deps.emitChanged()
        // Devolve o controle ao processo principal entre os lotes.
        await new Promise<void>((done) => setImmediate(done))
      }

      this.queueThumbnails(db, root)
      if (this.thumbnails.isIdle) {
        await removeOrphanThumbnails(this.deps.thumbnailsDir, db.thumbnailIds())
      }
    } catch (error) {
      this.deps.log(
        `[library] falha ao atualizar o índice: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      this.updating = false
    }
    // Avisa sempre: a tela deixa de mostrar "atualizando".
    this.deps.emitChanged()
  }

  /** Esvazia o índice se a pasta das Reuniões mudou. */
  private ensureRoot(db: LibraryDb, root: string): Promise<void> {
    const key = rootKey(root)
    if (db.getMeta('root') !== key) {
      db.clear()
      db.setMeta('root', key)
      this.aiStatus.clear()
    }
    return Promise.resolve()
  }

  private async forget(db: LibraryDb, folderName: string): Promise<boolean> {
    const id = db.remove(folderName)
    if (id) {
      this.thumbnails.remove(id)
      await removeThumbnail(this.deps.thumbnailsDir, id)
    }
    return id !== null
  }

  /** Relê a pasta e atualiza o índice se ela mudou. Devolve se o índice mudou. */
  private async indexFolder(db: LibraryDb, root: string, name: string): Promise<boolean> {
    const folder = join(root, name)
    const scan = await scanFolder(folder)
    if (!scan) return this.forget(db, name)

    const stored = db.findByFolder(name)
    if (stored?.signature === scan.signature) return false
    if (db.skippedFolders().get(name.toLowerCase()) === scan.signature) return false
    if (!scan.files.has(MEETING_FILE)) return this.forget(db, name)

    const read = await readMeeting(folder)
    if (!read.ok) {
      db.markSkipped(name, scan.signature)
      return true
    }
    const meeting = read.value

    // A mesma Reunião em duas pastas (cópia no Explorador): vale a que já está indexada.
    const owner = db.find(meeting.id)
    if (
      owner &&
      owner.folderName.toLowerCase() !== name.toLowerCase() &&
      (await fileExists(join(root, owner.folderName, MEETING_FILE)))
    ) {
      db.markSkipped(name, DUPLICATE_MARK)
      return true
    }

    const [transcript, summary] = await Promise.all([readTranscript(folder), readSummary(folder)])
    const row = buildRow(name, meeting, scan)
    db.upsert(
      row,
      buildFragments(
        meeting,
        transcript.ok ? transcript.value : null,
        summary.ok ? summary.value : null
      ),
      meetingTags(meeting)
    )

    if (!row.hasVideo) {
      this.thumbnails.remove(row.id)
      if (db.find(row.id)?.thumbSig) {
        db.clearThumbnail(row.id)
        await removeThumbnail(this.deps.thumbnailsDir, row.id)
      }
    } else if (row.status === 'ready' && row.videoSig !== null) {
      const current = db.find(row.id)
      if (current?.thumbSig !== row.videoSig) {
        this.thumbnails.enqueue([jobFor(root, name, row.id, row.durationMs, row.videoSig)])
      }
    }
    return true
  }

  private queueThumbnails(db: LibraryDb, root: string): void {
    this.thumbnails.enqueue(
      db
        .pendingThumbnails()
        .map((item) => jobFor(root, item.folderName, item.id, item.durationMs, item.videoSig))
    )
  }

  /** Atualiza uma Reunião (Anotação, nome, Falante, Resumo...). Ignora pastas fora da pasta das Reuniões. */
  async refresh(folder: string): Promise<void> {
    if (this.paused) return
    const root = this.deps.meetingsDir()
    if (!isDirectChild(root, folder)) return
    const db = await this.open()
    if (!db) return
    const name = basename(folder)
    const changed = await this.enqueue(() => this.indexFolder(db, root, name))
    if (changed) this.deps.emitChanged()
  }

  // --- Eventos do app -------------------------------------------------------------------------

  /** A etapa da gravação mudou: a pasta ativa (ou a recém-finalizada) é reindexada. */
  onRecordingState(state: RecordingState): void {
    if (state.phase === this.lastPhase) return
    this.lastPhase = state.phase
    const folder =
      state.phase === 'idle' ? (state.finished?.folder ?? null) : this.deps.activeFolder()
    if (folder) void this.refresh(folder)
    if (state.phase === 'idle') this.thumbnails.kick()
  }

  onTranscriptChanged(event: TranscriptChangedEvent): void {
    this.onAiChanged(`t:${event.meetingId}`, event.view.status, event.folder)
  }

  onSummaryChanged(event: SummaryChangedEvent): void {
    this.onAiChanged(`s:${event.meetingId}`, event.view.status, event.folder)
  }

  /** Só mudanças de estado interessam (o progresso da Transcrição chega várias vezes por segundo). */
  private onAiChanged(key: string, status: string, folder: string): void {
    if (this.aiStatus.get(key) === status) return
    this.aiStatus.set(key, status)
    void this.refresh(folder)
  }

  /** A gravação terminou ou outra tarefa pesada acabou: as miniaturas pendentes seguem. */
  resumeThumbnails(): void {
    this.thumbnails.kick()
  }
}

function jobFor(
  root: string,
  folderName: string,
  id: string,
  durationMs: number | null,
  videoSig: string
): ThumbnailJob {
  return { id, videoPath: join(root, folderName, MEETING_FILES.video), durationMs, videoSig }
}

function toItem(
  row: StoredMeeting,
  root: string,
  active: string | null,
  tags: string[],
  validGroups: readonly string[]
): MeetingListItem {
  const folder = join(root, row.folderName)
  const hasThumbnail = row.hasVideo && row.thumbOk && row.thumbSig === row.videoSig
  return {
    id: row.id,
    folder,
    name: row.name,
    createdAt: row.createdAt,
    durationMs: row.durationMs,
    status: row.status,
    live: active !== null && sameFolder(folder, active),
    source: { kind: row.sourceKind, name: row.sourceName },
    sizeBytes: row.sizeBytes,
    noteCount: row.noteCount,
    tags,
    groupId: row.groupId !== null && validGroups.includes(row.groupId) ? row.groupId : null,
    transcriptStatus: row.transcriptStatus,
    summaryStatus: row.summaryStatus,
    hasVideo: row.hasVideo,
    compactionStatus: row.compactionStatus,
    thumbnail: hasThumbnail ? thumbnailUrl(row.id, row.thumbAt) : null
  }
}
