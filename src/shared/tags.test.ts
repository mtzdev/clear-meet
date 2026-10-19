import { describe, expect, it } from 'vitest'
import {
  canonicalTag,
  checkTagName,
  cleanTagName,
  effectiveTags,
  hasTag,
  MAX_TAG_LENGTH,
  parseTagList,
  renameInList,
  sameTag,
  tagKey,
  withoutTag,
  withTag
} from './tags'

describe('checkTagName', () => {
  it('tira espaços das pontas e repetidos', () => {
    expect(checkTagName('  Daily   semanal ')).toEqual({ ok: true, name: 'Daily semanal' })
  })

  it('troca caracteres de controle por espaço', () => {
    const raw = `a${String.fromCharCode(0)}b${String.fromCharCode(9)}c`
    expect(checkTagName(raw)).toEqual({ ok: true, name: 'a b c' })
  })

  it('um nome maior só passa se for igual ao de uma Tag que já existe', () => {
    const long = 'a'.repeat(MAX_TAG_LENGTH + 4)
    expect(checkTagName(long).ok).toBe(false)
    expect(checkTagName(long, [long.toUpperCase()]).ok).toBe(true)
    expect(cleanTagName(long)).toEqual({ ok: true, name: long })
  })

  it('recusa nome vazio ou que não é texto', () => {
    expect(checkTagName('   ').ok).toBe(false)
    expect(checkTagName(null).ok).toBe(false)
    expect(checkTagName(42).ok).toBe(false)
  })

  it('aceita o tamanho máximo e recusa um caractere a mais', () => {
    expect(checkTagName('a'.repeat(MAX_TAG_LENGTH)).ok).toBe(true)
    expect(checkTagName('a'.repeat(MAX_TAG_LENGTH + 1)).ok).toBe(false)
  })
})

describe('unicidade', () => {
  it('não diferencia maiúsculas nem acentos', () => {
    expect(tagKey('Diária')).toBe('diaria')
    expect(sameTag('Daily', 'daily')).toBe(true)
    expect(sameTag('Reunião', 'reuniao')).toBe(true)
    expect(sameTag('Daily', 'Weekly')).toBe(false)
  })

  it('a lista mantém a grafia da primeira', () => {
    expect(withTag(['Daily'], 'daily')).toEqual(['Daily'])
    expect(withTag(['Daily'], 'Weekly')).toEqual(['Daily', 'Weekly'])
    expect(hasTag(['Diária'], 'DIARIA')).toBe(true)
    expect(canonicalTag(['Daily', 'Weekly'], 'weekly')).toBe('Weekly')
    expect(canonicalTag(['Daily'], 'Nova')).toBe('Nova')
  })

  it('remove sem diferenciar maiúsculas', () => {
    expect(withoutTag(['Daily', 'Weekly'], 'DAILY')).toEqual(['Weekly'])
  })
})

describe('parseTagList', () => {
  it('lê só nomes válidos e sem repetição', () => {
    expect(parseTagList(['Daily', ' daily ', '', 3, 'a'.repeat(101), 'Weekly'])).toEqual([
      'Daily',
      'Weekly'
    ])
    // Limites de hoje (16 caracteres, 3 Tags) não se aplicam à leitura.
    const many = ['Uma', 'Duas', 'Tres', 'Quatro', 'a'.repeat(20)]
    expect(parseTagList(many)).toEqual(many)
    expect(parseTagList(undefined)).toEqual([])
    expect(parseTagList('Daily')).toEqual([])
  })
})

describe('renameInList', () => {
  it('troca mantendo a posição', () => {
    expect(renameInList(['A', 'Daily', 'B'], 'daily', 'Diária')).toEqual(['A', 'Diária', 'B'])
  })

  it('troca só a grafia quando a identidade é a mesma', () => {
    expect(renameInList(['daily'], 'daily', 'Daily')).toEqual(['Daily'])
  })

  it('junta quando o destino já está na lista', () => {
    expect(renameInList(['Daily', 'Diária'], 'Daily', 'Diária')).toEqual(['Diária'])
    expect(renameInList(['Diária', 'Daily'], 'Daily', 'Diária')).toEqual(['Diária'])
  })
})

describe('effectiveTags', () => {
  it('une o catálogo e as Tags das Reuniões, com a contagem das Reuniões', () => {
    const tags = effectiveTags(
      ['Vazia', 'Daily'],
      [
        { name: 'daily', count: 3 },
        { name: 'Copiada', count: 1 }
      ]
    )
    expect(tags).toEqual([
      { name: 'Copiada', count: 1 },
      { name: 'Daily', count: 3 },
      { name: 'Vazia', count: 0 }
    ])
  })

  it('ordena sem diferenciar acentos nem maiúsculas', () => {
    expect(effectiveTags(['c', 'Éa', 'B', 'a'], []).map((tag) => tag.name)).toEqual([
      'a',
      'B',
      'c',
      'Éa'
    ])
  })
})
