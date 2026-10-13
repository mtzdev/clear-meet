import type { Speaker } from '@shared/transcript'
import { OVERLAP_MS } from './plan'

/**
 * Resposta esperada do Gemini. O Falante é uma referência (`speakerId`) a uma lista declarada
 * antes das Falas, então o modelo não tem onde escrever um horário ou uma frase no lugar do Falante.
 */
export const TRANSCRIPT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    speakers: {
      type: 'array',
      description: 'Every distinct voice in the audio.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Short id: s1, s2, s3...' },
          name: {
            type: ['string', 'null'],
            description: 'The name, only if it is said in the conversation; otherwise null.'
          }
        },
        required: ['id', 'name']
      }
    },
    utterances: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          speakerId: { type: 'string', description: 'The id of the speaker, from "speakers".' },
          start: {
            type: 'string',
            description: 'Moment the utterance starts, counted from the start of this audio: MM:SS.'
          },
          text: { type: 'string', description: 'What was said.' }
        },
        required: ['speakerId', 'start', 'text']
      }
    }
  },
  required: ['speakers', 'utterances']
} as const

export interface PromptInput {
  chunkIndex: number
  chunkCount: number
  /** Falantes já identificados nos blocos anteriores. */
  knownSpeakers: readonly Speaker[]
}

/** Instruções do modelo em inglês (mais estável); o texto transcrito sai no idioma falado. */
export function buildTranscriptionPrompt(input: PromptInput): string {
  const lines = [
    'Transcribe this meeting recording and identify who is speaking.',
    '',
    '- Write what is said in the language that is spoken. Do not translate or summarize.',
    '- Different voices are different speakers. Every time the speaker changes, start a new utterance: a conversation between people is never a single utterance.',
    '- First list the distinct speakers in "speakers", each with a short id (s1, s2, ...). Set "name" only if the person\'s name is said in the conversation; otherwise null. A name is never a time, a number or a description.',
    "- Each utterance has the speaker's id, the moment it starts counted from the start of this audio (MM:SS) and the text.",
    '- Ignore silence and non-speech sounds.'
  ]
  if (input.chunkCount > 1) {
    lines.push(
      '',
      `This audio is part ${input.chunkIndex + 1} of ${input.chunkCount} of a longer meeting.`
    )
    if (input.chunkIndex > 0) {
      lines.push(
        `Its first ${OVERLAP_MS / 1000} seconds repeat the end of the previous part; transcribe them normally.`
      )
    }
  }
  if (input.knownSpeakers.length > 0) {
    const known = input.knownSpeakers
      .map((speaker) => `${speaker.id}: ${speaker.name ? `"${speaker.name}"` : '(name unknown)'}`)
      .join('; ')
    lines.push(
      '',
      `Speakers heard earlier in the meeting: ${known}.`,
      'When one of these voices speaks again, reuse its id (and its name, if it has one). Give a new id only to a voice that is really new.'
    )
  }
  return lines.join('\n')
}
