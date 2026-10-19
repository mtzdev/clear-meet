import {
  buildHistory,
  MAX_QUESTION_LENGTH,
  type ChatEvent,
  type ChatMessage,
  type ChatSent,
  type ChatState
} from '@shared/chat'
import type { AiProvider } from '@shared/ai'
import type { RecordingError, Result } from '@shared/recording'
import { appendChatMessage, clearChat, readChat } from '../../meetings/chat-store'
import { sameFolder } from '../../meetings/paths'
import { isDirectChild, readMeeting } from '../../meetings/repository'
import { readTranscript } from '../../meetings/transcript-store'
import { AI_MESSAGES, isAiError } from '../errors'
import { formatMeetingForAi } from '../text/format'
import { chatSystemPrompt } from '../text/prompts'
import type { TextHooks, TextRequest, TextResult } from '../text/types'

/** O que a Conversa usa do roteador de texto (permite testar sem rede). */
export interface ChatTextRouter {
  hasProvider(): boolean
  run(request: TextRequest, signal: AbortSignal, hooks?: TextHooks): Promise<TextResult>
}

export interface ChatDeps {
  meetingsDir(): string
  router: ChatTextRouter
  emit(event: ChatEvent): void
  now(): number
  newId(): string
  log(message: string): void
}

interface Active {
  meetingId: string
  messageId: string
  controller: AbortController
  text: string
}

const MAX_OUTPUT_TOKENS = 2048

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

/**
 * Conversa com a IA sobre uma Reunião: a Transcrição inteira vai no contexto e a resposta
 * chega aos poucos, por eventos. O histórico fica em `chat.json`; uma resposta por Reunião
 * ao mesmo tempo. Navegar na UI não interrompe a geração.
 */
export class ChatService {
  private readonly active = new Map<string, Active>()

  constructor(private readonly deps: ChatDeps) {}

  private find(folder: string): Active | undefined {
    for (const [key, value] of this.active) if (sameFolder(key, folder)) return value
    return undefined
  }

  isActive(folder: string): boolean {
    return this.find(folder) !== undefined
  }

  hasActive(): boolean {
    return this.active.size > 0
  }

  async get(folder: string): Promise<Result<ChatState>> {
    if (!isDirectChild(this.deps.meetingsDir(), folder)) {
      return fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
    }
    const chat = await readChat(folder)
    if (!chat.ok) return chat
    const active = this.find(folder)
    return {
      ok: true,
      value: {
        messages: chat.value,
        pending: active ? { messageId: active.messageId, text: active.text } : null
      }
    }
  }

  /**
   * Faz uma pergunta (`text`) ou, com `null`, repete a última que ficou sem resposta (erro).
   * Devolve já com a pergunta gravada; a resposta vem por eventos.
   */
  async send(folder: string, text: string | null): Promise<Result<ChatSent>> {
    if (!isDirectChild(this.deps.meetingsDir(), folder)) {
      return fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
    }
    if (this.isActive(folder)) {
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
    const read = await readMeeting(folder)
    if (!read.ok) return fail('not-found', 'A Reunião não foi encontrada.')
    const meeting = read.value
    if (meeting.status !== 'ready' || meeting.transcript?.status !== 'ready') {
      return fail('invalid-request', 'A Conversa precisa da Transcrição pronta.')
    }
    const transcript = await readTranscript(folder)
    if (!transcript.ok) return fail(transcript.error.code, transcript.error.message)
    if (!transcript.value || transcript.value.utterances.length === 0) {
      return fail('invalid-request', 'A Transcrição está vazia: não há o que perguntar.')
    }
    if (this.isActive(folder)) {
      return fail('busy', 'A IA ainda está respondendo. Espere ou pare a resposta.')
    }

    let user: ChatMessage | null = null
    const stored = await readChat(folder)
    if (!stored.ok) return stored
    let history = stored.value
    if (question !== null) {
      user = {
        id: this.deps.newId(),
        role: 'user',
        text: question,
        createdAt: new Date(this.deps.now()).toISOString()
      }
      const appended = await appendChatMessage(folder, user)
      if (!appended.ok) return appended
      history = appended.value
    } else if (history[history.length - 1]?.role !== 'user') {
      return fail('invalid-request', 'Não há pergunta sem resposta para repetir.')
    }

    const active: Active = {
      meetingId: meeting.id,
      messageId: this.deps.newId(),
      controller: new AbortController(),
      text: ''
    }
    this.active.set(folder, active)
    const request: TextRequest = {
      system: chatSystemPrompt(formatMeetingForAi(meeting, transcript.value, meeting.notes)),
      messages: buildHistory(history),
      maxOutputTokens: MAX_OUTPUT_TOKENS
    }
    void this.run(folder, active, request)
    return { ok: true, value: { user, assistantId: active.messageId } }
  }

  stop(folder: string): void {
    this.find(folder)?.controller.abort()
  }

  /** Apaga a Conversa; uma resposta em andamento é interrompida antes. */
  async clear(folder: string): Promise<Result<null>> {
    if (!isDirectChild(this.deps.meetingsDir(), folder)) {
      return fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
    }
    this.stop(folder)
    for (let waited = 0; this.isActive(folder) && waited < 50; waited++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    return clearChat(folder)
  }

  private async run(folder: string, active: Active, request: TextRequest): Promise<void> {
    const { meetingId, messageId } = active
    let provider: AiProvider | undefined
    let model: string | undefined
    const finish = (event: ChatEvent): void => {
      this.active.delete(folder)
      this.deps.emit(event)
    }
    try {
      const result = await this.deps.router.run(request, active.controller.signal, {
        onDelta: (delta) => {
          active.text += delta
          this.deps.emit({ type: 'delta', meetingId, messageId, text: delta })
        }
      })
      provider = result.provider
      model = result.model
      if (result.text.trim() === '') {
        finish({ type: 'error', meetingId, messageId, message: AI_MESSAGES['bad-response'] })
        return
      }
      const message = this.assistantMessage(messageId, result.text, provider, model, false)
      await this.save(folder, message)
      finish({ type: 'done', meetingId, messageId, message })
    } catch (error) {
      if (active.controller.signal.aborted) {
        const partial = active.text.trim()
        const message =
          partial === ''
            ? null
            : this.assistantMessage(messageId, active.text, provider, model, true)
        if (message) await this.save(folder, message)
        finish({ type: 'done', meetingId, messageId, message })
        return
      }
      this.deps.log(`[conversa] falhou: ${isAiError(error) ? error.kind : 'erro desconhecido'}`)
      finish({
        type: 'error',
        meetingId,
        messageId,
        message: isAiError(error) ? error.message : AI_MESSAGES.unknown
      })
    }
  }

  private assistantMessage(
    id: string,
    text: string,
    provider: AiProvider | undefined,
    model: string | undefined,
    stopped: boolean
  ): ChatMessage {
    return {
      id,
      role: 'assistant',
      text,
      createdAt: new Date(this.deps.now()).toISOString(),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(stopped ? { stopped: true } : {})
    }
  }

  private async save(folder: string, message: ChatMessage): Promise<void> {
    const saved = await appendChatMessage(folder, message)
    if (!saved.ok) this.deps.log('[conversa] não foi possível gravar a resposta no disco')
  }
}
