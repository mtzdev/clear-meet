import { rmSync } from 'node:fs'
import type { ListCompaction } from '@shared/compaction'
import type { CaptureSourceKind, MeetingStatus } from '@shared/meeting'
import type { HitKind, LibrarySort } from '@shared/library'
import type { SummaryStatus } from '@shared/summary'
import { tagKey, type TagInfo } from '@shared/tags'
import type { TranscriptStatus } from '@shared/transcript'
import type { Database, SqliteModule } from './sqlite'

/** Muda quando o formato do índice muda: o índice antigo é descartado e reconstruído das pastas. */
export const LIBRARY_SCHEMA_VERSION = 4

export const IN_MEMORY = ':memory:'

export interface MeetingRow {
  id: string
  /** Só o nome da pasta: o índice não guarda caminhos absolutos. */
  folderName: string
  name: string
  createdAt: string
  createdMs: number
  durationMs: number | null
  status: MeetingStatus
  sourceKind: CaptureSourceKind
  sourceName: string | null
  sizeBytes: number
  noteCount: number
  transcriptStatus: TranscriptStatus
  summaryStatus: SummaryStatus
  hasVideo: boolean
  compactionStatus: ListCompaction
  /** Grupo gravado no `meeting.json`; pode apontar para um grupo que não existe mais. */
  groupId: string | null
  /** Tamanho e data do `video.mp4`; muda quando o Vídeo é trocado ou apagado. */
  videoSig: string | null
  /** Tamanho e data dos arquivos da pasta no momento da leitura: mudou, reindexa. */
  signature: string
}

export interface StoredMeeting extends MeetingRow {
  /** `videoSig` para o qual a miniatura foi gerada (ou tentada). */
  thumbSig: string | null
  thumbOk: boolean
  /** Quando a miniatura foi gerada (ms): versão da URL. */
  thumbAt: number
}

export interface FragmentInput {
  kind: HitKind
  offsetMs: number | null
  speaker: string | null
  body: string
}

export interface SearchParams {
  /** Consulta FTS5 já montada; `null` = só filtros. */
  fts: string | null
  fromMs: number | null
  toMs: number | null
  /** Chaves (`tagKey`) das Tags do filtro; a Reunião precisa ter ao menos uma. */
  tagKeys: readonly string[]
  group: GroupFilter | null
  sort: LibrarySort
  limit: number
}

/** Filtro de grupo: um grupo, ou as Reuniões sem grupo (ou com um `groupId` fora de `validIds`). */
export type GroupFilter = { kind: 'id'; id: string } | { kind: 'none'; validIds: readonly string[] }

export interface GroupStatsRow {
  count: number
  totalDurationMs: number
  /** Início (ms) da Reunião mais recente. */
  lastMs: number
}

export interface GroupSubjectRow {
  id: string
  folderName: string
  name: string
  createdAt: string
  durationMs: number | null
  status: MeetingStatus
  sourceKind: CaptureSourceKind
  sourceName: string | null
  groupId: string | null
}

export interface HitRow {
  kind: HitKind
  offsetMs: number | null
  speaker: string | null
  body: string
}

export interface PendingThumbnail {
  id: string
  folderName: string
  durationMs: number | null
  videoSig: string
}

type Row = Record<string, unknown>
type Param = string | number | null

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE meetings (
  id TEXT PRIMARY KEY,
  folder_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_name TEXT,
  size_bytes INTEGER NOT NULL,
  note_count INTEGER NOT NULL,
  transcript_status TEXT NOT NULL,
  summary_status TEXT NOT NULL,
  has_video INTEGER NOT NULL,
  compaction_status TEXT NOT NULL DEFAULT 'none',
  group_id TEXT,
  video_sig TEXT,
  signature TEXT NOT NULL,
  thumb_sig TEXT,
  thumb_ok INTEGER NOT NULL DEFAULT 0,
  thumb_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX meetings_created ON meetings (created_ms);
CREATE INDEX meetings_group ON meetings (group_id);

CREATE TABLE meeting_tags (
  meeting_id TEXT NOT NULL,
  tag_key TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (meeting_id, tag_key)
);
CREATE INDEX meeting_tags_key ON meeting_tags (tag_key);

CREATE TABLE skipped (
  folder_name TEXT PRIMARY KEY COLLATE NOCASE,
  signature TEXT NOT NULL
);

CREATE TABLE fragments (
  id INTEGER PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  offset_ms INTEGER,
  speaker TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX fragments_meeting ON fragments (meeting_id);

CREATE VIRTUAL TABLE fragments_fts USING fts5(
  speaker, body,
  content = 'fragments', content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER fragments_ai AFTER INSERT ON fragments BEGIN
  INSERT INTO fragments_fts (rowid, speaker, body) VALUES (new.id, new.speaker, new.body);
END;
CREATE TRIGGER fragments_ad AFTER DELETE ON fragments BEGIN
  INSERT INTO fragments_fts (fragments_fts, rowid, speaker, body)
  VALUES ('delete', old.id, old.speaker, old.body);
END;
`

const MEETING_COLUMNS = `id, folder_name, name, created_at, created_ms, duration_ms, status,
  source_kind, source_name, size_bytes, note_count, transcript_status, summary_status, has_video,
  compaction_status, group_id, video_sig, signature`

function toStored(row: Row): StoredMeeting {
  return {
    id: row['id'] as string,
    folderName: row['folder_name'] as string,
    name: row['name'] as string,
    createdAt: row['created_at'] as string,
    createdMs: row['created_ms'] as number,
    durationMs: (row['duration_ms'] as number | null) ?? null,
    status: row['status'] as MeetingStatus,
    sourceKind: row['source_kind'] as CaptureSourceKind,
    sourceName: (row['source_name'] as string | null) ?? null,
    sizeBytes: row['size_bytes'] as number,
    noteCount: row['note_count'] as number,
    transcriptStatus: row['transcript_status'] as TranscriptStatus,
    summaryStatus: row['summary_status'] as SummaryStatus,
    hasVideo: row['has_video'] === 1,
    compactionStatus: row['compaction_status'] as ListCompaction,
    groupId: (row['group_id'] as string | null) ?? null,
    videoSig: (row['video_sig'] as string | null) ?? null,
    signature: row['signature'] as string,
    thumbSig: (row['thumb_sig'] as string | null) ?? null,
    thumbOk: row['thumb_ok'] === 1,
    thumbAt: row['thumb_at'] as number
  }
}

function whereClause(params: SearchParams): { sql: string; values: Param[] } {
  const clauses: string[] = []
  const values: Param[] = []
  if (params.tagKeys.length > 0) {
    const marks = params.tagKeys.map(() => '?').join(', ')
    clauses.push(
      `EXISTS (SELECT 1 FROM meeting_tags t WHERE t.meeting_id = m.id AND t.tag_key IN (${marks}))`
    )
    values.push(...params.tagKeys)
  }
  if (params.group?.kind === 'id') {
    clauses.push('m.group_id = ?')
    values.push(params.group.id)
  } else if (params.group?.kind === 'none') {
    const ids = params.group.validIds
    clauses.push(
      ids.length === 0
        ? '1 = 1'
        : `(m.group_id IS NULL OR m.group_id NOT IN (${ids.map(() => '?').join(', ')}))`
    )
    values.push(...ids)
  }
  if (params.fromMs !== null) {
    clauses.push('m.created_ms >= ?')
    values.push(params.fromMs)
  }
  if (params.toMs !== null) {
    clauses.push('m.created_ms < ?')
    values.push(params.toMs)
  }
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', values }
}

const BEST_FRAGMENT_SCORE =
  "(CASE WHEN f.kind IN ('name', 'tag') THEN fragments_fts.rank * 3 ELSE fragments_fts.rank END)"

function orderBy(sort: LibrarySort, hasText: boolean): string {
  switch (sort) {
    case 'oldest':
      return 'm.created_ms ASC, m.folder_name'
    case 'longest':
      return 'm.duration_ms IS NULL, m.duration_ms DESC, m.created_ms DESC'
    case 'relevance':
      if (hasText) return 'best.score ASC, m.created_ms DESC'
      return 'm.created_ms DESC, m.folder_name'
    case 'newest':
      return 'm.created_ms DESC, m.folder_name'
  }
}

/** O índice SQLite da Biblioteca: leitura e escrita síncronas, sempre derivadas das pastas. */
export class LibraryDb {
  constructor(private readonly db: Database) {}

  close(): void {
    this.db.close()
  }

  private all(sql: string, params: Param[] = []): Row[] {
    return this.db.prepare(sql).all(...params)
  }

  private get(sql: string, params: Param[] = []): Row | undefined {
    return this.db.prepare(sql).get(...params)
  }

  private run(sql: string, params: Param[] = []): void {
    this.db.prepare(sql).run(...params)
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getMeta(key: string): string | null {
    const row = this.get('SELECT value FROM meta WHERE key = ?', [key])
    return row ? (row['value'] as string) : null
  }

  setMeta(key: string, value: string): void {
    this.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value])
  }

  /** Esvazia o índice (a pasta das Reuniões mudou). */
  clear(): void {
    this.transaction(() => {
      this.db.exec(
        'DELETE FROM fragments; DELETE FROM meeting_tags; DELETE FROM meetings; DELETE FROM skipped;'
      )
    })
  }

  /** Pastas indexadas, por nome em minúsculas (o Windows ignora maiúsculas). */
  indexedFolders(): Map<string, { id: string; folderName: string; signature: string }> {
    const map = new Map<string, { id: string; folderName: string; signature: string }>()
    for (const row of this.all('SELECT id, folder_name, signature FROM meetings')) {
      const folderName = row['folder_name'] as string
      map.set(folderName.toLowerCase(), {
        id: row['id'] as string,
        folderName,
        signature: row['signature'] as string
      })
    }
    return map
  }

  skippedFolders(): Map<string, string> {
    return new Map(
      this.all('SELECT folder_name, signature FROM skipped').map((row) => [
        (row['folder_name'] as string).toLowerCase(),
        row['signature'] as string
      ])
    )
  }

  skippedCount(): number {
    return this.get('SELECT count(*) AS n FROM skipped')?.['n'] as number
  }

  count(): number {
    return this.get('SELECT count(*) AS n FROM meetings')?.['n'] as number
  }

  /** Pasta ilegível ou repetida: guardada para não ser relida até mudar. */
  markSkipped(folderName: string, signature: string): void {
    this.transaction(() => {
      this.removeFolder(folderName)
      this.run('INSERT OR REPLACE INTO skipped (folder_name, signature) VALUES (?, ?)', [
        folderName,
        signature
      ])
    })
  }

  /** Grava a Reunião e troca os trechos pesquisáveis e as Tags. A miniatura já gerada é preservada. */
  upsert(row: MeetingRow, fragments: readonly FragmentInput[], tags: readonly string[] = []): void {
    this.transaction(() => {
      // Outra linha na mesma pasta (a Reunião foi substituída) ou a mesma Reunião em outra pasta.
      const clash = this.get('SELECT id FROM meetings WHERE folder_name = ? AND id <> ?', [
        row.folderName,
        row.id
      ])
      if (clash) this.deleteMeeting(clash['id'] as string)
      this.run('DELETE FROM skipped WHERE folder_name = ?', [row.folderName])
      this.run(
        `INSERT INTO meetings (${MEETING_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           folder_name = excluded.folder_name, name = excluded.name,
           created_at = excluded.created_at, created_ms = excluded.created_ms,
           duration_ms = excluded.duration_ms, status = excluded.status,
           source_kind = excluded.source_kind, source_name = excluded.source_name,
           size_bytes = excluded.size_bytes, note_count = excluded.note_count,
           transcript_status = excluded.transcript_status, summary_status = excluded.summary_status,
           has_video = excluded.has_video, compaction_status = excluded.compaction_status,
           group_id = excluded.group_id, video_sig = excluded.video_sig,
           signature = excluded.signature`,
        [
          row.id,
          row.folderName,
          row.name,
          row.createdAt,
          row.createdMs,
          row.durationMs,
          row.status,
          row.sourceKind,
          row.sourceName,
          row.sizeBytes,
          row.noteCount,
          row.transcriptStatus,
          row.summaryStatus,
          row.hasVideo ? 1 : 0,
          row.compactionStatus,
          row.groupId,
          row.videoSig,
          row.signature
        ]
      )
      this.run('DELETE FROM meeting_tags WHERE meeting_id = ?', [row.id])
      const insertTag = this.db.prepare(
        'INSERT OR IGNORE INTO meeting_tags (meeting_id, tag_key, name) VALUES (?, ?, ?)'
      )
      for (const tag of tags) insertTag.run(row.id, tagKey(tag), tag)
      this.run('DELETE FROM fragments WHERE meeting_id = ?', [row.id])
      const insert = this.db.prepare(
        'INSERT INTO fragments (meeting_id, kind, offset_ms, speaker, body) VALUES (?, ?, ?, ?, ?)'
      )
      for (const fragment of fragments) {
        insert.run(row.id, fragment.kind, fragment.offsetMs, fragment.speaker ?? '', fragment.body)
      }
    })
  }

  private deleteMeeting(id: string): void {
    this.run('DELETE FROM fragments WHERE meeting_id = ?', [id])
    this.run('DELETE FROM meeting_tags WHERE meeting_id = ?', [id])
    this.run('DELETE FROM meetings WHERE id = ?', [id])
  }

  private removeFolder(folderName: string): string | null {
    const row = this.get('SELECT id FROM meetings WHERE folder_name = ?', [folderName])
    if (!row) return null
    this.deleteMeeting(row['id'] as string)
    return row['id'] as string
  }

  /** Tira a pasta do índice (apagada ou movida). Devolve o `id` removido, se havia. */
  remove(folderName: string): string | null {
    return this.transaction(() => {
      this.run('DELETE FROM skipped WHERE folder_name = ?', [folderName])
      return this.removeFolder(folderName)
    })
  }

  find(id: string): StoredMeeting | null {
    const row = this.get('SELECT * FROM meetings WHERE id = ?', [id])
    return row ? toStored(row) : null
  }

  findByFolder(folderName: string): StoredMeeting | null {
    const row = this.get('SELECT * FROM meetings WHERE folder_name = ?', [folderName])
    return row ? toStored(row) : null
  }

  /** Tags de cada Reunião pedida, na ordem em que foram gravadas na Reunião. */
  tagsFor(meetingIds: readonly string[]): Map<string, string[]> {
    const result = new Map<string, string[]>()
    if (meetingIds.length === 0) return result
    const marks = meetingIds.map(() => '?').join(', ')
    for (const row of this.all(
      `SELECT meeting_id, name FROM meeting_tags WHERE meeting_id IN (${marks}) ORDER BY rowid`,
      [...meetingIds]
    )) {
      const id = row['meeting_id'] as string
      const list = result.get(id) ?? []
      list.push(row['name'] as string)
      result.set(id, list)
    }
    return result
  }

  /** Tags usadas por alguma Reunião, com quantas Reuniões cada uma tem. */
  tagCounts(): TagInfo[] {
    return this.all(
      'SELECT MIN(name) AS name, count(*) AS n FROM meeting_tags GROUP BY tag_key'
    ).map((row) => ({ name: row['name'] as string, count: row['n'] as number }))
  }

  /** Contagem, duração total e última Reunião de cada grupo que tem Reuniões. */
  groupStats(): Map<string, GroupStatsRow> {
    const stats = new Map<string, GroupStatsRow>()
    for (const row of this.all(
      `SELECT group_id, count(*) AS n, COALESCE(SUM(duration_ms), 0) AS total, MAX(created_ms) AS last
       FROM meetings WHERE group_id IS NOT NULL GROUP BY group_id`
    )) {
      stats.set(row['group_id'] as string, {
        count: row['n'] as number,
        totalDurationMs: row['total'] as number,
        lastMs: row['last'] as number
      })
    }
    return stats
  }

  /** O que as regras dos grupos precisam de cada Reunião (sem as Tags, que vêm de `tagsFor`). */
  groupSubjects(): GroupSubjectRow[] {
    return this.all(
      `SELECT id, folder_name, name, created_at, duration_ms, status, source_kind, source_name, group_id
       FROM meetings ORDER BY created_ms DESC`
    ).map((row) => ({
      id: row['id'] as string,
      folderName: row['folder_name'] as string,
      name: row['name'] as string,
      createdAt: row['created_at'] as string,
      durationMs: (row['duration_ms'] as number | null) ?? null,
      status: row['status'] as MeetingStatus,
      sourceKind: row['source_kind'] as CaptureSourceKind,
      sourceName: (row['source_name'] as string | null) ?? null,
      groupId: (row['group_id'] as string | null) ?? null
    }))
  }

  /** Reuniões com Vídeo cuja miniatura não foi gerada para o Vídeo atual, mais recentes primeiro. */
  pendingThumbnails(): PendingThumbnail[] {
    return this.all(
      `SELECT id, folder_name, duration_ms, video_sig FROM meetings
       WHERE has_video = 1 AND video_sig IS NOT NULL AND status = 'ready'
         AND (thumb_sig IS NULL OR thumb_sig <> video_sig)
       ORDER BY created_ms DESC`
    ).map((row) => ({
      id: row['id'] as string,
      folderName: row['folder_name'] as string,
      durationMs: (row['duration_ms'] as number | null) ?? null,
      videoSig: row['video_sig'] as string
    }))
  }

  /** Ids que têm miniatura em disco (para limpar as órfãs). */
  thumbnailIds(): string[] {
    return this.all('SELECT id FROM meetings WHERE thumb_ok = 1').map((row) => row['id'] as string)
  }

  setThumbnail(id: string, signature: string, ok: boolean, at: number): void {
    this.run('UPDATE meetings SET thumb_sig = ?, thumb_ok = ?, thumb_at = ? WHERE id = ?', [
      signature,
      ok ? 1 : 0,
      at,
      id
    ])
  }

  clearThumbnail(id: string): void {
    this.run('UPDATE meetings SET thumb_sig = NULL, thumb_ok = 0 WHERE id = ?', [id])
  }

  query(params: SearchParams): { rows: StoredMeeting[]; total: number } {
    const filter = whereClause(params)
    if (params.fts === null) {
      const rows = this.all(
        `SELECT m.* FROM meetings m ${filter.sql} ORDER BY ${orderBy(params.sort, false)} LIMIT ?`,
        [...filter.values, params.limit]
      )
      const total = this.get(`SELECT count(*) AS n FROM meetings m ${filter.sql}`, filter.values)
      return { rows: rows.map(toStored), total: (total?.['n'] as number | undefined) ?? 0 }
    }
    const best = `WITH best AS (
        SELECT f.meeting_id AS meeting_id, MIN(${BEST_FRAGMENT_SCORE}) AS score
        FROM fragments_fts JOIN fragments f ON f.id = fragments_fts.rowid
        WHERE fragments_fts MATCH ?
        GROUP BY f.meeting_id
      )`
    const from = `FROM best JOIN meetings m ON m.id = best.meeting_id ${filter.sql}`
    const rows = this.all(
      `${best} SELECT m.* ${from} ORDER BY ${orderBy(params.sort, true)} LIMIT ?`,
      [params.fts, ...filter.values, params.limit]
    ).map(toStored)
    // Só conta de novo quando o limite cortou a lista: a consulta com FTS é a parte cara.
    if (rows.length < params.limit) return { rows, total: rows.length }
    const total = this.get(`${best} SELECT count(*) AS n ${from}`, [params.fts, ...filter.values])
    return { rows, total: (total?.['n'] as number | undefined) ?? 0 }
  }

  /** Os melhores trechos de cada Reunião para a busca `fts`, e quantos trechos casaram. */
  hits(
    fts: string,
    meetingIds: readonly string[],
    perMeeting: number
  ): Map<string, { hits: HitRow[]; total: number }> {
    const result = new Map<string, { hits: HitRow[]; total: number }>()
    if (meetingIds.length === 0) return result
    const marks = meetingIds.map(() => '?').join(', ')
    const rows = this.all(
      `SELECT * FROM (
         SELECT f.meeting_id AS meeting_id, f.kind AS kind, f.offset_ms AS offset_ms,
                f.speaker AS speaker, f.body AS body,
                ROW_NUMBER() OVER (PARTITION BY f.meeting_id ORDER BY ${BEST_FRAGMENT_SCORE}) AS n,
                COUNT(*) OVER (PARTITION BY f.meeting_id) AS total
         FROM fragments_fts JOIN fragments f ON f.id = fragments_fts.rowid
         WHERE fragments_fts MATCH ? AND f.meeting_id IN (${marks})
       ) WHERE n <= ? ORDER BY meeting_id, n`,
      [fts, ...meetingIds, perMeeting]
    )
    for (const row of rows) {
      const id = row['meeting_id'] as string
      const entry = result.get(id) ?? { hits: [], total: row['total'] as number }
      entry.hits.push({
        kind: row['kind'] as HitKind,
        offsetMs: (row['offset_ms'] as number | null) ?? null,
        speaker: row['speaker'] === '' ? null : (row['speaker'] as string),
        body: row['body'] as string
      })
      result.set(id, entry)
    }
    return result
  }
}

function removeDatabaseFiles(path: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    rmSync(`${path}${suffix}`, { force: true })
  }
}

function attempt(sqlite: SqliteModule, path: string): LibraryDb {
  const db = new sqlite.DatabaseSync(path)
  try {
    if (path !== IN_MEMORY) db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version
    if (version === 0) {
      db.exec('BEGIN')
      db.exec(SCHEMA)
      db.exec(`PRAGMA user_version = ${LIBRARY_SCHEMA_VERSION}`)
      db.exec('COMMIT')
    } else if (version !== LIBRARY_SCHEMA_VERSION) {
      throw new Error(`versão ${version} do índice não é suportada`)
    } else {
      const check = db.prepare('PRAGMA quick_check(1)').get() as Row
      if (Object.values(check)[0] !== 'ok') throw new Error('o índice está corrompido')
    }
    return new LibraryDb(db)
  } catch (error) {
    db.close()
    throw error
  }
}

/**
 * Abre o índice. Arquivo novo ganha o esquema; arquivo de outra versão, corrompido ou que
 * não abre é apagado e recriado vazio (o índice é só um cache das pastas).
 */
export function openLibraryDb(
  sqlite: SqliteModule,
  path: string,
  log: (message: string) => void = () => undefined
): LibraryDb {
  try {
    return attempt(sqlite, path)
  } catch (error) {
    log(`[library] índice descartado: ${error instanceof Error ? error.message : String(error)}`)
    if (path !== IN_MEMORY) removeDatabaseFiles(path)
    return attempt(sqlite, path)
  }
}

/** FTS5 compilado no SQLite do runtime? (Em algumas versões do Node o `node:sqlite` não tem.) */
export function hasFts5(sqlite: SqliteModule): boolean {
  const db = new sqlite.DatabaseSync(IN_MEMORY)
  try {
    db.exec('CREATE VIRTUAL TABLE probe USING fts5(body)')
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}
