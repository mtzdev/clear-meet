import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MEETING_FILE, MEETING_SCHEMA_VERSION, type MeetingFile } from '@shared/meeting'
import {
  isDirectChild,
  listMeetingFolders,
  readMeeting,
  renameMeeting,
  withFolderLock,
  writeMeeting
} from './repository'

function meeting(overrides: Partial<MeetingFile> = {}): MeetingFile {
  return {
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: 'id-1',
    name: 'Nome antigo',
    createdAt: new Date(2026, 9, 10, 14, 30).toISOString(),
    endedAt: null,
    durationMs: null,
    status: 'ready',
    source: { kind: 'none', name: null },
    quality: '1080p',
    video: null,
    audio: { file: 'audio.opus' },
    inputs: { mic: true, systemAudio: true },
    notes: [],
    issues: [],
    ...overrides
  }
}

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clearmeet-repo-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function createMeeting(folderName: string, overrides: Partial<MeetingFile> = {}) {
  const folder = join(root, folderName)
  await mkdir(folder)
  await writeMeeting(folder, meeting(overrides))
  return folder
}

describe('meeting.json no disco', () => {
  it('grava e lê de volta; não deixa temporários', async () => {
    const folder = await createMeeting('2026-10-10 1430 - Nome antigo')
    expect(await readMeeting(folder)).toEqual({ ok: true, value: meeting() })
    expect(await readdir(folder)).toEqual([MEETING_FILE])
  })

  it('arquivo ausente ou corrompido vira erro, sem lançar', async () => {
    const folder = join(root, 'vazia')
    await mkdir(folder)
    expect(await readMeeting(folder)).toEqual({ ok: false, error: 'meeting.json não encontrado' })
    await writeFile(join(folder, MEETING_FILE), '{ "schemaVersion": 1, ')
    const result = await readMeeting(folder)
    expect(result.ok).toBe(false)
  })

  it('lista só pastas (qualquer uma pode ser uma Reunião); raiz inexistente = vazio', async () => {
    await createMeeting('a')
    await writeFile(join(root, 'solto.txt'), 'x')
    // Pastas reservadas: exclusão em andamento e a dos grupos.
    await mkdir(join(root, '.excluindo-1'))
    await mkdir(join(root, '.clearmeet'))
    await mkdir(join(root, '.CLEARMEET2'))
    expect(await listMeetingFolders(root)).toEqual([join(root, '.CLEARMEET2'), join(root, 'a')])
    await rm(join(root, '.CLEARMEET2'), { recursive: true })
    expect(await listMeetingFolders(root)).toEqual([join(root, 'a')])
    expect(await listMeetingFolders(join(root, 'nao-existe'))).toEqual([])
  })
})

describe('isDirectChild', () => {
  it('aceita só filhos diretos da pasta das Reuniões', () => {
    expect(isDirectChild(root, join(root, 'a'))).toBe(true)
    expect(isDirectChild(root, root)).toBe(false)
    expect(isDirectChild(root, join(root, 'a', 'b'))).toBe(false)
    expect(isDirectChild(root, join(root, '..'))).toBe(false)
    expect(isDirectChild(root, join(root, '..', 'outra'))).toBe(false)
    expect(isDirectChild(join(root, 'x'), join(root, 'xy'))).toBe(false)
  })
})

describe('renameMeeting', () => {
  it('atualiza o nome no meeting.json e renomeia a pasta (mantendo a data de início)', async () => {
    const folder = await createMeeting('2026-10-10 1430 - Nome antigo')
    const result = await renameMeeting(root, folder, '  Revisão: Q3?  ')

    const expected = join(root, '2026-10-10 1430 - Revisão Q3')
    expect(result).toEqual({
      ok: true,
      value: { folder: expected, name: 'Revisão: Q3?', folderRenamed: true }
    })
    expect(await listMeetingFolders(root)).toEqual([expected])
    const saved = await readMeeting(expected)
    expect(saved.ok && saved.value.name).toBe('Revisão: Q3?')
  })

  it('colisão com outra pasta: usa sufixo e não toca na outra', async () => {
    await createMeeting('2026-10-10 1430 - Alvo', { id: 'outra', name: 'Alvo' })
    const folder = await createMeeting('2026-10-10 1430 - Original')
    const result = await renameMeeting(root, folder, 'Alvo')
    expect(result.ok && result.value.folder).toBe(join(root, '2026-10-10 1430 - Alvo (2)'))
    const other = await readMeeting(join(root, '2026-10-10 1430 - Alvo'))
    expect(other.ok && other.value.id).toBe('outra')
  })

  it('mesmo nome: nada muda', async () => {
    const folder = await createMeeting('2026-10-10 1430 - Nome antigo')
    const result = await renameMeeting(root, folder, 'Nome antigo')
    expect(result).toEqual({
      ok: true,
      value: { folder, name: 'Nome antigo', folderRenamed: true }
    })
  })

  it('recusa nome vazio, pasta fora da pasta das Reuniões e pasta sem meeting.json', async () => {
    const folder = await createMeeting('a')
    const empty = await renameMeeting(root, folder, '   ')
    expect(!empty.ok && empty.error.code).toBe('invalid-request')

    const outside = await mkdtemp(join(tmpdir(), 'clearmeet-fora-'))
    try {
      const out = await renameMeeting(root, outside, 'x')
      expect(!out.ok && out.error.code).toBe('invalid-request')
    } finally {
      await rm(outside, { recursive: true, force: true })
    }

    await mkdir(join(root, 'sem-json'))
    const noJson = await renameMeeting(root, join(root, 'sem-json'), 'x')
    expect(noJson.ok).toBe(false)
    expect(await readFile(join(folder, MEETING_FILE), 'utf8')).toContain('Nome antigo')
  })
})

describe('renameMeeting: casos de borda', () => {
  it('pasta em uso (rename falha): o nome fica salvo e a pasta mantém o nome antigo', async () => {
    const folder = await createMeeting('2026-10-10 1430 - Nome antigo')
    const busy = (): Promise<void> =>
      Promise.reject(Object.assign(new Error('em uso'), { code: 'EBUSY' }))
    const result = await renameMeeting(root, folder, 'Nome novo', busy)
    expect(result).toEqual({
      ok: true,
      value: { folder, name: 'Nome novo', folderRenamed: false }
    })
    const saved = await readMeeting(folder)
    expect(saved.ok && saved.value.name).toBe('Nome novo')
    expect(await listMeetingFolders(root)).toEqual([folder])
  })

  it('sanitiza caracteres inválidos do Windows, nomes reservados e tamanho', async () => {
    const folder = await createMeeting('2026-10-10 1430 - Nome antigo')
    const weird = await renameMeeting(root, folder, String.raw`a<b>c:d"e/f\g|h?i*j. `)
    expect(weird.ok && basename(weird.value.folder)).toBe('2026-10-10 1430 - a b c d e f g h i j')
    expect(weird.ok && weird.value.name).toBe(String.raw`a<b>c:d"e/f\g|h?i*j.`)

    const reserved = await renameMeeting(root, weird.ok ? weird.value.folder : folder, 'CON')
    expect(reserved.ok && basename(reserved.value.folder)).toBe('2026-10-10 1430 - CON_')

    const long = await renameMeeting(
      root,
      reserved.ok ? reserved.value.folder : folder,
      'x'.repeat(300)
    )
    expect(long.ok && basename(long.value.folder)).toBe(`2026-10-10 1430 - ${'x'.repeat(80)}`)
  })

  it('nome só com símbolos inválidos cai no nome padrão da pasta, mas o nome é preservado', async () => {
    const folder = await createMeeting('2026-10-10 1430 - Nome antigo')
    const result = await renameMeeting(root, folder, '???')
    expect(result.ok && basename(result.value.folder)).toBe('2026-10-10 1430 - Reunião')
    expect(result.ok && result.value.name).toBe('???')
  })

  it('a data no nome da pasta é a de início, não a de hoje', async () => {
    const folder = await createMeeting('2026-10-10 1430 - Nome antigo', {
      createdAt: new Date(2025, 0, 5, 9, 7).toISOString()
    })
    const result = await renameMeeting(root, folder, 'Outro')
    expect(result.ok && basename(result.value.folder)).toBe('2025-01-05 0907 - Outro')
  })

  it('três renomeações para o mesmo nome geram sufixos (2), (3)...', async () => {
    const a = await createMeeting('a', { id: 'a' })
    const b = await createMeeting('b', { id: 'b' })
    const c = await createMeeting('c', { id: 'c' })
    const names: string[] = []
    for (const folder of [a, b, c]) {
      const result = await renameMeeting(root, folder, 'Mesmo')
      if (result.ok) names.push(basename(result.value.folder))
    }
    expect(names).toEqual([
      '2026-10-10 1430 - Mesmo',
      '2026-10-10 1430 - Mesmo (2)',
      '2026-10-10 1430 - Mesmo (3)'
    ])
  })
})

describe('withFolderLock', () => {
  it('executa as tarefas da mesma pasta em fila, mesmo se uma falhar', async () => {
    const order: string[] = []
    const slow = withFolderLock('x', async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      order.push('lenta')
    })
    const failing = withFolderLock('x', () => {
      order.push('falha')
      return Promise.reject(new Error('boom'))
    })
    const last = withFolderLock('x', () => {
      order.push('última')
      return Promise.resolve()
    })
    await slow
    await expect(failing).rejects.toThrow('boom')
    await last
    expect(order).toEqual(['lenta', 'falha', 'última'])
  })
})
