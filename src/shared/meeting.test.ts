import { describe, expect, it } from 'vitest'
import {
  MEETING_SCHEMA_VERSION,
  meetingTags,
  needsRecovery,
  parseMeeting,
  parseMeetingText,
  serializeMeeting,
  type MeetingFile
} from './meeting'

function meeting(overrides: Partial<MeetingFile> = {}): MeetingFile {
  return {
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: '6f1c2c8e-2a49-4b79-8f0e-3e6f0f7e1a11',
    name: 'Revisão do trimestre',
    createdAt: '2026-10-10T17:30:00.000Z',
    endedAt: '2026-10-10T18:15:00.000Z',
    durationMs: 2_700_000,
    status: 'ready',
    source: { kind: 'window', name: 'Reunião - Meet' },
    quality: '1080p',
    video: { file: 'video.mp4', width: 1920, height: 1080, fps: 15 },
    audio: { file: 'audio.opus' },
    inputs: { mic: true, systemAudio: true },
    notes: [],
    issues: [],
    ...overrides
  }
}

describe('meeting.json: ida e volta', () => {
  it('serializa e lê de volta o mesmo conteúdo', () => {
    const original = meeting({
      notes: [
        {
          id: 'n1',
          offsetMs: 12_000,
          text: 'Perguntar sobre o prazo',
          createdAt: '2026-10-10T17:31:00.000Z'
        }
      ]
    })
    const text = serializeMeeting(original)
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toMatchObject({ schemaVersion: 1, name: 'Revisão do trimestre' })
    const parsed = parseMeetingText(text)
    expect(parsed).toEqual({ ok: true, value: original })
  })

  it('Anotações: várias, com texto de várias linhas e acentos, voltam idênticas (schema 1 mantido)', () => {
    const original = meeting({
      status: 'recording',
      endedAt: null,
      durationMs: null,
      notes: [
        { id: 'a', offsetMs: 0, text: 'Início', createdAt: '2026-10-10T17:31:00.000Z' },
        {
          id: 'b',
          offsetMs: 83_250,
          text: 'Decisão: migrar para a nova API\n- responsável: Ana',
          createdAt: '2026-10-10T17:32:30.000Z'
        }
      ]
    })
    const text = serializeMeeting(original)
    expect(JSON.parse(text)).toMatchObject({ schemaVersion: MEETING_SCHEMA_VERSION })
    expect(MEETING_SCHEMA_VERSION).toBe(1)
    expect(parseMeetingText(text)).toEqual({ ok: true, value: original })
  })

  it('aceita uma Reunião só de áudio, ainda gravando', () => {
    const recording = meeting({
      status: 'recording',
      endedAt: null,
      durationMs: null,
      source: { kind: 'none', name: null },
      video: null
    })
    expect(parseMeeting(JSON.parse(serializeMeeting(recording)))).toEqual({
      ok: true,
      value: recording
    })
  })

  it('lê o estado do Resumo e ignora um bloco inválido', () => {
    const summary = {
      status: 'ready' as const,
      provider: 'groq' as const,
      model: 'openai/gpt-oss-120b',
      updatedAt: '2026-10-13T10:00:00.000Z'
    }
    const withSummary = meeting({ summary })
    expect(parseMeeting(JSON.parse(serializeMeeting(withSummary)))).toEqual({
      ok: true,
      value: withSummary
    })

    const raw = JSON.parse(serializeMeeting(meeting())) as Record<string, unknown>
    raw.summary = 'resumo'
    const parsed = parseMeeting(raw)
    expect(parsed.ok && parsed.value.summary).toBeUndefined()
  })

  it('lê o estado da Transcrição e ignora um bloco inválido', () => {
    const transcript = {
      status: 'error' as const,
      error: 'falhou',
      model: 'gemini-3.5-flash-lite',
      updatedAt: '2026-10-12T10:00:00.000Z',
      summaryRequested: true
    }
    const withTranscript = meeting({ transcript })
    expect(parseMeeting(JSON.parse(serializeMeeting(withTranscript)))).toEqual({
      ok: true,
      value: withTranscript
    })

    const raw = JSON.parse(serializeMeeting(meeting())) as Record<string, unknown>
    raw.transcript = { status: 'quase' }
    const parsed = parseMeeting(raw)
    expect(parsed.ok && parsed.value.transcript).toBeUndefined()
  })

  it('video.compaction: arquivo antigo (sem o bloco) continua legível; o bloco volta idêntico', () => {
    const old = parseMeeting(JSON.parse(serializeMeeting(meeting())))
    expect(old.ok && old.value.video?.compaction).toBeUndefined()

    const compaction = {
      status: 'done' as const,
      codec: 'av1',
      encoder: 'libsvtav1',
      originalBytes: 1000,
      finalBytes: 300,
      updatedAt: '2026-10-16T12:00:00.000Z'
    }
    const withBlock = meeting({
      video: { file: 'video.mp4', width: 1920, height: 1080, fps: 15, compaction }
    })
    const parsed = parseMeetingText(serializeMeeting(withBlock))
    expect(parsed).toEqual({ ok: true, value: withBlock })

    const broken = JSON.parse(serializeMeeting(withBlock)) as { video: { compaction: unknown } }
    broken.video.compaction = { status: 'quase' }
    const ignored = parseMeeting(broken)
    expect(ignored.ok && ignored.value.video?.compaction).toBeUndefined()
  })

  it('issues: ausente vale lista vazia (arquivos antigos); ocorrências são preservadas', () => {
    const raw = JSON.parse(serializeMeeting(meeting())) as Record<string, unknown>
    delete raw.issues
    const parsed = parseMeeting(raw)
    expect(parsed.ok && parsed.value.issues).toEqual([])

    const withIssue = meeting({ issues: [{ code: 'video-encoder-stalled', atMs: 15_000 }] })
    expect(parseMeeting(JSON.parse(serializeMeeting(withIssue)))).toEqual({
      ok: true,
      value: withIssue
    })
  })

  it('aceita BOM no início do arquivo (editores do Windows)', () => {
    const text = String.fromCharCode(0xfeff) + serializeMeeting(meeting())
    expect(parseMeetingText(text).ok).toBe(true)
  })
})

describe('meeting.json: validação', () => {
  const invalid = (patch: Record<string, unknown>) =>
    parseMeeting({ ...(JSON.parse(serializeMeeting(meeting())) as object), ...patch })

  it('rejeita o que não é objeto ou não é JSON', () => {
    expect(parseMeeting(null).ok).toBe(false)
    expect(parseMeeting([]).ok).toBe(false)
    expect(parseMeeting('texto').ok).toBe(false)
    expect(parseMeetingText('{ quebrado')).toEqual({
      ok: false,
      error: 'meeting.json não é um JSON válido'
    })
  })

  it('exige a versão do esquema suportada', () => {
    const newer = invalid({ schemaVersion: 2 })
    expect(newer.ok).toBe(false)
    expect(!newer.ok && newer.error).toContain('schemaVersion 2')
    const missing = invalid({ schemaVersion: undefined })
    expect(!missing.ok && missing.error).toContain('ausente')
  })

  it.each([
    ['id vazio', { id: '' }],
    ['name não é texto', { name: 5 }],
    ['createdAt inválido', { createdAt: 'ontem' }],
    ['endedAt inválido', { endedAt: 'x' }],
    ['durationMs negativo', { durationMs: -1 }],
    ['status desconhecido', { status: 'quase' }],
    ['source sem tipo válido', { source: { kind: 'camera', name: null } }],
    ['quality inválido', { quality: '4k' }],
    ['video incompleto', { video: { file: 'video.mp4' } }],
    ['video fora da pasta', { video: { file: '..\\x.mp4', width: 1, height: 1, fps: 15 } }],
    ['audio fora da pasta', { audio: { file: 'sub/audio.opus' } }],
    ['inputs inválido', { inputs: { mic: 'sim', systemAudio: true } }],
    ['notes não é lista', { notes: {} }],
    ['issues com código desconhecido', { issues: [{ code: 'x', atMs: 1 }] }],
    ['issues não é lista', { issues: 5 }],
    [
      'Anotação com Instante negativo',
      { notes: [{ id: 'a', offsetMs: -5, text: 'x', createdAt: '2026-10-10T17:31:00.000Z' }] }
    ]
  ])('rejeita: %s', (_name, patch) => {
    expect(invalid(patch).ok).toBe(false)
  })
})

describe('needsRecovery', () => {
  it('só uma Reunião pronta dispensa a recuperação', () => {
    expect(needsRecovery('ready')).toBe(false)
    expect(needsRecovery('recording')).toBe(true)
    expect(needsRecovery('processing')).toBe(true)
    expect(needsRecovery('unprocessed')).toBe(true)
  })
})

describe('Tags no meeting.json', () => {
  const base = {
    schemaVersion: 1,
    id: 'id-1',
    name: 'Reunião',
    createdAt: '2026-10-10T17:30:00.000Z',
    endedAt: '2026-10-10T18:00:00.000Z',
    durationMs: 60_000,
    status: 'ready',
    source: { kind: 'none', name: null },
    quality: '1080p',
    video: null,
    audio: { file: 'audio.opus' },
    inputs: { mic: true, systemAudio: true },
    notes: [],
    issues: []
  }

  it('um arquivo antigo, sem o campo, continua válido e sem Tags', () => {
    const parsed = parseMeeting(base)
    expect(parsed.ok && parsed.value.tags).toBeUndefined()
    expect(parsed.ok && meetingTags(parsed.value)).toEqual([])
  })

  it('lê as Tags válidas e descarta repetidas e inválidas', () => {
    const parsed = parseMeeting({ ...base, tags: ['Daily', 'daily', '', 7, 'Diária'] })
    expect(parsed.ok && parsed.value.tags).toEqual(['Daily', 'Diária'])
  })

  it('mais de 3 Tags e nomes longos abrem sem perder nada', () => {
    const tags = ['A', 'B', 'C', 'D', 'um nome bem maior que dezesseis']
    const parsed = parseMeeting({ ...base, tags })
    expect(parsed.ok && parsed.value.tags).toEqual(tags)
  })

  it('ida e volta pelo texto preserva as Tags', () => {
    const parsed = parseMeeting({ ...base, tags: ['Daily'] })
    if (!parsed.ok) throw new Error(parsed.error)
    const again = parseMeetingText(serializeMeeting(parsed.value))
    expect(again.ok && again.value.tags).toEqual(['Daily'])
  })
})

describe('grupo da Reunião', () => {
  const base = meeting()

  it('um arquivo antigo, sem o campo, continua válido e sem grupo', () => {
    const parsed = parseMeeting(base)
    expect(parsed.ok && parsed.value.groupId).toBeUndefined()
  })

  it('lê o groupId e ignora valores que não são texto', () => {
    const parsed = parseMeeting({ ...base, groupId: 'grupo-1' })
    expect(parsed.ok && parsed.value.groupId).toBe('grupo-1')
    expect(parseMeeting({ ...base, groupId: 7 }).ok).toBe(true)
    const invalid = parseMeeting({ ...base, groupId: 7 })
    expect(invalid.ok && invalid.value.groupId).toBeUndefined()
  })

  it('ida e volta pelo texto preserva o grupo', () => {
    const parsed = parseMeeting({ ...base, groupId: 'grupo-1' })
    if (!parsed.ok) throw new Error(parsed.error)
    const again = parseMeetingText(serializeMeeting(parsed.value))
    expect(again.ok && again.value.groupId).toBe('grupo-1')
  })
})
