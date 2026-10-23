import {
  buildHistory,
  MAX_QUESTION_LENGTH,
  MAX_STORED_MESSAGES,
  type ChatMessage
} from '@shared/chat'
import {
  assignLabels,
  parseScope,
  resolveScope,
  scopeSummaryText,
  type GroupChatEvent,
  type GroupChatMessage,
  type GroupChatSent,
  type GroupChatState,
  type GroupScope,
  type MeetingRelevance,
  type ScopeCandidate,
  type ScopeRef
} from '@shared/group-chat'
import type { RecordingError, Result } from '@shared/recording'
import type { GroupChatStore } from '../../groups/chat-store'
import type { GroupMeetingRef } from '../../library/service'
import { readMeeting } from '../../meetings/repository'
import { readSummary } from '../../meetings/summary-store'
import { readTranscript } from '../../meetings/transcript-store'
import { generateAnswer, type ChatTextRouter } from '../chat/answer'
import { groupChatSystemPrompt } from '../text/prompts'
import type { TextRequest } from '../text/types'
import { buildGroupContext, relevanceQuery, type ContextMeeting } from './context'

export interface GroupChatDeps {
  store: GroupChatStore
  groupExists(groupId: string): Promise<boolean>
  /** Reuniões do grupo, da mais recente para a mais antiga. */
  meetings(groupId: string): Promise<GroupMeetingRef[]>
  /** Relevância das Reuniões para uma busca FTS5 (palavras em OU). */
  relevance(meetingIds: string[], fts: string): Promise<Map<string, MeetingRelevance>>
  router: ChatTextRouter
  emit(event: GroupChatEvent): void
  now(): number
  newId(): string
  log(message: string): void
}

interface Active {
  messageId: string
  controller: AbortController
  text: string
  refs: ScopeRef[]
}

const MAX_OUTPUT_TOKENS = 3072
const NO_GROUP = 'O grupo não existe mais.'
const NO_TRANSCRIPTS =
  'Nenhuma Reunião do escopo tem Transcrição pronta. Ajuste o período ou o número de Reuniões, ou gere as Transcrições.'

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

function toCandidate(ref: GroupMeetingRef): ScopeCandidate {
  return {
    id: ref.id,
    name: ref.name,
    createdAt: ref.createdAt,
    durationMs: ref.durationMs,
    hasTranscript: ref.hasTranscript
  }
}

type Loaded = Omit<ContextMeeting, 'label'>

interface Prepared {
  request: TextRequest
  user: ChatMessage | null
  refs: ScopeRef[]
}

/**
 * Conversa com a IA sobre um grupo de Reuniões. A cada pergunta o escopo (período, máximo e
 * marcações) escolhe as Reuniões; o contexto de cada uma cabe num orçamento de tamanho e a
 * resposta chega aos poucos, por eventos, citando `[R2 05:32]`. A Conversa e o escopo ficam em
 * `.clearmeet/chats/<id>.json`; uma resposta por grupo ao mesmo tempo.
 */
export class GroupChatService {
  private readonly active = new Map<string, Active>()

  constructor(private readonly deps: GroupChatDeps) {}

  isActive(groupId: string): boolean {
    return this.active.has(groupId)
  }

  hasActive(): boolean {
    return this.active.size > 0
  }

  async get(groupId: string): Promise<Result<GroupChatState>> {
    if (!(await this.deps.groupExists(groupId))) return fail('not-found', NO_GROUP)
    const read = await this.deps.store.read(groupId)
    if (!read.ok) return fail('unknown', read.message)
    const active = this.active.get(groupId)
    return {
      ok: true,
      value: {
        messages: read.chat.messages,
        pending: active ? { messageId: active.messageId, text: active.text } : null,
        pendingScope: active?.refs ?? [],
        scope: read.chat.scope
      }
    }
  }

  async meetings(groupId: string): Promise<Result<ScopeCandidate[]>> {
    if (!(await this.deps.groupExists(groupId))) return fail('not-found', NO_GROUP)
    return { ok: true, value: (await this.deps.meetings(groupId)).map(toCandidate) }
  }

  async setScope(groupId: string, raw: unknown): Promise<Result<GroupScope>> {
    if (!(await this.deps.groupExists(groupId))) return fail('not-found', NO_GROUP)
    const parsed = parseScope(raw)
    const known = new Set((await this.deps.meetings(groupId)).map((meeting) => meeting.id))
    const scope: GroupScope = {
      ...parsed,
      include: parsed.include.filter((id) => known.has(id)),
      exclude: parsed.exclude.filter((id) => known.has(id))
    }
    const saved = await this.deps.store.update(groupId, (chat) =>
      JSON.stringify(chat.scope) === JSON.stringify(scope) ? null : { ...chat, scope }
    )
    return saved.ok ? { ok: true, value: scope } : saved
  }

  /**
   * Faz uma pergunta (`text`) ou, com `null`, repete a última que ficou sem resposta (erro).
   * Devolve já com a pergunta gravada; a resposta vem por eventos.
   */
  async send(groupId: string, text: string | null): Promise<Result<GroupChatSent>> {
    if (this.active.has(groupId)) {
      return fail('busy', 'A IA ainda está respondendo. Espere ou pare a resposta.')
    }
    const question = text === null ? null : text.trim()
    if (question !== null && question === '') {
      return fail('invalid-request', 'Escreva uma pergunta.')
    }
    if (question !== null && question.length > MAX_QUESTION_LENGTH) {
      return fail('invalid-request', 'A pergunta é longa demais.')
    }
    if (!this.deps.router.hasProvider()) {
      return fail('no-api-key', 'Configure a chave do Gemini ou da Groq nas Configurações.')
    }
    const active: Active = {
      messageId: this.deps.newId(),
      controller: new AbortController(),
      text: '',
      refs: []
    }
    this.active.set(groupId, active)
    try {
      const prepared = await this.prepare(groupId, question)
      if (!prepared.ok) {
        this.active.delete(groupId)
        return prepared
      }
      const { request, refs, user } = prepared.value
      active.refs = refs
      void this.run(groupId, active, request, refs)
      return { ok: true, value: { user, assistantId: active.messageId, scope: refs } }
    } catch (error) {
      this.active.delete(groupId)
      this.deps.log(`[conversa-grupo] não preparou a pergunta: ${String(error)}`)
      return fail('unknown', 'Não foi possível preparar a pergunta.')
    }
  }

  private async prepare(groupId: string, question: string | null): Promise<Result<Prepared>> {
    if (!(await this.deps.groupExists(groupId))) return fail('not-found', NO_GROUP)
    const read = await this.deps.store.read(groupId)
    if (!read.ok) return fail('unknown', read.message)
    const stored = read.chat
    const last = stored.messages[stored.messages.length - 1]
    if (question === null && last?.role !== 'user') {
      return fail('invalid-request', 'Não há pergunta sem resposta para repetir.')
    }
    const asked = question ?? last?.text ?? ''

    const candidates = await this.deps.meetings(groupId)
    const resolution = resolveScope(candidates.map(toCandidate), stored.scope, this.deps.now())
    const wanted = new Set(resolution.selected.map((candidate) => candidate.id))
    const loaded = await this.load(candidates.filter((candidate) => wanted.has(candidate.id)))
    if (loaded.length === 0) return fail('invalid-request', NO_TRANSCRIPTS)

    const query = relevanceQuery(asked)
    let relevance = new Map<string, MeetingRelevance>()
    if (query) {
      try {
        relevance = await this.deps.relevance(
          loaded.map((meeting) => meeting.id),
          query
        )
      } catch (error) {
        this.deps.log(`[conversa-grupo] busca de relevância falhou: ${String(error)}`)
      }
    }

    const { labels } = assignLabels(stored.labels, loaded)
    const built = buildGroupContext(
      loaded.map((meeting) => ({ ...meeting, label: labels[meeting.id] as number })),
      relevance
    )

    const user: ChatMessage | null =
      question === null
        ? null
        : {
            id: this.deps.newId(),
            role: 'user',
            text: question,
            createdAt: new Date(this.deps.now()).toISOString()
          }
    const saved = await this.deps.store.update(groupId, (chat) => ({
      ...chat,
      labels: { ...chat.labels, ...labels },
      messages: user ? [...chat.messages, user].slice(-MAX_STORED_MESSAGES) : chat.messages
    }))
    if (!saved.ok) return saved

    const scopeText = scopeSummaryText(
      loaded.map((meeting) => ({ ...meeting, hasTranscript: true }))
    )
    return {
      ok: true,
      value: {
        user,
        refs: built.refs,
        request: {
          system: groupChatSystemPrompt(built.text, scopeText),
          messages: buildHistory(saved.value.messages),
          maxOutputTokens: MAX_OUTPUT_TOKENS
        }
      }
    }
  }

  /** Lê do disco (a verdade) as Reuniões do escopo; as que não abrem ou perderam a Transcrição ficam de fora. */
  private async load(refs: readonly GroupMeetingRef[]): Promise<Loaded[]> {
    const loaded = await Promise.all(
      refs.map(async (ref): Promise<Loaded | null> => {
        const meeting = await readMeeting(ref.folder)
        if (
          !meeting.ok ||
          meeting.value.id !== ref.id ||
          meeting.value.status !== 'ready' ||
          meeting.value.transcript?.status !== 'ready'
        ) {
          return null
        }
        const transcript = await readTranscript(ref.folder)
        if (!transcript.ok || !transcript.value || transcript.value.utterances.length === 0) {
          return null
        }
        const summary =
          meeting.value.summary?.status === 'ready' ? await readSummary(ref.folder) : null
        return {
          id: ref.id,
          name: meeting.value.name,
          createdAt: meeting.value.createdAt,
          durationMs: meeting.value.durationMs ?? transcript.value.durationMs,
          transcript: transcript.value,
          summary: summary?.ok ? summary.value : null,
          notes: meeting.value.notes
        }
      })
    )
    return loaded.filter((meeting): meeting is Loaded => meeting !== null)
  }

  stop(groupId: string): void {
    this.active.get(groupId)?.controller.abort()
  }

  private async settle(groupId: string): Promise<void> {
    this.stop(groupId)
    for (let waited = 0; this.active.has(groupId) && waited < 50; waited++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  /** Apaga as mensagens (o escopo escolhido fica); uma resposta em andamento é interrompida antes. */
  async clear(groupId: string): Promise<Result<null>> {
    await this.settle(groupId)
    const saved = await this.deps.store.update(groupId, (chat) =>
      chat.messages.length === 0 && Object.keys(chat.labels).length === 0
        ? null
        : { ...chat, messages: [], labels: {} }
    )
    return saved.ok ? { ok: true, value: null } : saved
  }

  /** O grupo foi apagado: interrompe a resposta e apaga o arquivo da Conversa. */
  async discard(groupId: string): Promise<Result<null>> {
    await this.settle(groupId)
    return this.deps.store.remove(groupId)
  }

  private async run(
    groupId: string,
    active: Active,
    request: TextRequest,
    refs: ScopeRef[]
  ): Promise<void> {
    const { messageId } = active
    const finish = (event: GroupChatEvent): void => {
      this.active.delete(groupId)
      this.deps.emit(event)
    }
    const outcome = await generateAnswer({
      router: this.deps.router,
      request,
      signal: active.controller.signal,
      messageId,
      streamed: active,
      onDelta: (text) => this.deps.emit({ type: 'delta', groupId, messageId, text }),
      now: () => this.deps.now(),
      log: (message) => this.deps.log(message),
      logTag: '[conversa-grupo]'
    })
    if (outcome.type === 'error') {
      finish({ type: 'error', groupId, messageId, message: outcome.message })
      return
    }
    const message: GroupChatMessage | null = outcome.message
      ? { ...outcome.message, scope: refs }
      : null
    if (message) {
      const saved = await this.deps.store.update(groupId, (chat) => ({
        ...chat,
        messages: [...chat.messages, message].slice(-MAX_STORED_MESSAGES)
      }))
      if (!saved.ok) this.deps.log('[conversa-grupo] não foi possível gravar a resposta no disco')
    }
    finish({ type: 'done', groupId, messageId, message })
  }
}
