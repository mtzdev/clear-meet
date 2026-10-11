import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createUniqueFolder,
  defaultMeetingName,
  formatFolderStamp,
  MAX_NAME_LENGTH,
  meetingFolderBase,
  sanitizeName,
  suggestMeetingName,
  withSuffix
} from './folder-name'

describe('sanitizeName', () => {
  it('troca os caracteres inválidos do Windows', () => {
    expect(sanitizeName('Reunião: Q3 / Planejamento <final>?')).toBe(
      'Reunião Q3 Planejamento final'
    )
    expect(sanitizeName('a\\b|c*d"e')).toBe('a b c d e')
  })

  it('tira espaços e pontos do fim (o Windows os descarta) e junta espaços repetidos', () => {
    expect(sanitizeName('  Reunião   com   Ana...  ')).toBe('Reunião com Ana')
    expect(sanitizeName('fim. . ')).toBe('fim')
  })

  it('remove caracteres de controle', () => {
    expect(sanitizeName('linha1\nlinha2\ttab\u0000')).toBe('linha1 linha2 tab')
  })

  it('evita nomes reservados do Windows', () => {
    expect(sanitizeName('CON')).toBe('CON_')
    expect(sanitizeName('nul')).toBe('nul_')
    expect(sanitizeName('com1.txt')).toBe('com1.txt_')
    expect(sanitizeName('Console')).toBe('Console')
  })

  it('nunca devolve vazio', () => {
    expect(sanitizeName('')).toBe('Reunião')
    expect(sanitizeName('???')).toBe('Reunião')
    expect(sanitizeName('...', 'Outra')).toBe('Outra')
  })

  it('limita o tamanho', () => {
    const long = 'a'.repeat(500)
    expect(sanitizeName(long)).toHaveLength(MAX_NAME_LENGTH)
    expect(sanitizeName('a'.repeat(MAX_NAME_LENGTH - 1) + ' . . .')).toBe(
      'a'.repeat(MAX_NAME_LENGTH - 1)
    )
  })

  it('preserva acentos e emojis comuns', () => {
    expect(sanitizeName('Reunião de conclusão — ação')).toBe('Reunião de conclusão — ação')
  })
})

describe('nome da pasta', () => {
  const date = new Date(2026, 9, 10, 14, 5) // 10/out/2026 14:05, hora local

  it('data e hora locais no formato AAAA-MM-DD HHMM', () => {
    expect(formatFolderStamp(date)).toBe('2026-10-10 1405')
    expect(formatFolderStamp(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02 0304')
  })

  it('AAAA-MM-DD HHMM - Nome, já saneado', () => {
    expect(meetingFolderBase(date, 'Revisão: Q3?')).toBe('2026-10-10 1405 - Revisão Q3')
  })

  it('sufixo de colisão', () => {
    expect(withSuffix('base', 1)).toBe('base')
    expect(withSuffix('base', 2)).toBe('base (2)')
  })
})

describe('nome sugerido', () => {
  const date = new Date(2026, 9, 10, 14, 30)

  it('janela: o título da janela gravada', () => {
    expect(
      suggestMeetingName({ kind: 'window', name: 'Reunião semanal - Google Meet' }, date)
    ).toBe('Reunião semanal - Google Meet')
  })

  it('tela e só áudio: "Reunião de dd/MM HH:mm"', () => {
    expect(suggestMeetingName({ kind: 'screen', name: 'Tela 1' }, date)).toBe(
      'Reunião de 10/10 14:30'
    )
    expect(suggestMeetingName({ kind: 'none', name: null }, date)).toBe('Reunião de 10/10 14:30')
    expect(defaultMeetingName(date)).toBe('Reunião de 10/10 14:30')
  })

  it('janela sem título usa o nome padrão', () => {
    expect(suggestMeetingName({ kind: 'window', name: '   ' }, date)).toBe('Reunião de 10/10 14:30')
  })
})

describe('createUniqueFolder', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'clearmeet-folders-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('cria a pasta e, se já existe, uma com sufixo', async () => {
    const first = await createUniqueFolder(root, '2026-10-10 1405 - Teste')
    const second = await createUniqueFolder(root, '2026-10-10 1405 - Teste')
    const third = await createUniqueFolder(root, '2026-10-10 1405 - Teste')
    expect(first).toBe(join(root, '2026-10-10 1405 - Teste'))
    expect(second).toBe(join(root, '2026-10-10 1405 - Teste (2)'))
    expect(third).toBe(join(root, '2026-10-10 1405 - Teste (3)'))
    expect((await readdir(root)).sort()).toHaveLength(3)
  })

  it('cria a pasta raiz se ela não existe', async () => {
    const nested = join(root, 'nova', 'raiz')
    const folder = await createUniqueFolder(nested, 'x')
    expect(folder).toBe(join(nested, 'x'))
  })

  it('duas criações simultâneas não colidem', async () => {
    const [a, b] = await Promise.all([
      createUniqueFolder(root, 'mesma'),
      createUniqueFolder(root, 'mesma')
    ])
    expect(a).not.toBe(b)
  })

  it('erros diferentes de "já existe" são relançados', async () => {
    await expect(
      createUniqueFolder(root, 'x', () =>
        Promise.reject(Object.assign(new Error('x'), { code: 'EACCES' }))
      )
    ).rejects.toMatchObject({ code: 'EACCES' })
  })
})
