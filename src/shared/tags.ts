export const MAX_TAG_LENGTH = 16
export const MAX_TAGS_PER_MEETING = 3
/** Teto só para ler arquivos: nomes maiores que o limite de hoje continuam válidos. */
const MAX_STORED_TAG_LENGTH = 100

export const MAX_TAGS_TEXT = `Máximo de ${MAX_TAGS_PER_MEETING} Tags`

/** Uma Tag do catálogo efetivo, com quantas Reuniões a usam. */
export interface TagInfo {
  name: string
  count: number
}

export type TagNameCheck = { ok: true; name: string } | { ok: false; message: string }

function withoutControlChars(text: string): string {
  return Array.from(text, (char) => {
    const code = char.charCodeAt(0)
    return code < 32 || code === 127 ? ' ' : char
  }).join('')
}

/** Nome sem espaços nas pontas e repetidos, sem conferir o tamanho (Tags que já existem). */
export function cleanTagName(raw: unknown): TagNameCheck {
  const name = typeof raw === 'string' ? withoutControlChars(raw).replace(/\s+/g, ' ').trim() : ''
  if (name === '') return { ok: false, message: 'Digite um nome para a Tag.' }
  if (name.length > MAX_STORED_TAG_LENGTH) {
    return { ok: false, message: `A Tag pode ter até ${MAX_TAG_LENGTH} caracteres.` }
  }
  return { ok: true, name }
}

/**
 * Nome de uma Tag nova: limpo e de até `MAX_TAG_LENGTH` caracteres. Um nome igual ao de uma Tag
 * de `known` passa mesmo se for maior (veio de um arquivo antigo ou de outro PC).
 */
export function checkTagName(raw: unknown, known: readonly string[] = []): TagNameCheck {
  const cleaned = cleanTagName(raw)
  if (cleaned.ok && cleaned.name.length > MAX_TAG_LENGTH && !hasTag(known, cleaned.name)) {
    return { ok: false, message: `A Tag pode ter até ${MAX_TAG_LENGTH} caracteres.` }
  }
  return cleaned
}

/** Identidade da Tag: sem diferenciar maiúsculas nem acentos ("Diária" = "diaria"). */
export function tagKey(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
}

export function sameTag(a: string, b: string): boolean {
  return tagKey(a) === tagKey(b)
}

export function hasTag(list: readonly string[], name: string): boolean {
  const key = tagKey(name)
  return list.some((item) => tagKey(item) === key)
}

/**
 * Lê a lista de Tags de um arquivo: ignora o que não é nome válido e as repetidas. Não aplica
 * os limites de tamanho e de quantidade, para o arquivo abrir e não ser reescrito sem querer.
 */
export function parseTagList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const list: string[] = []
  for (const item of raw) {
    const checked = cleanTagName(item)
    if (checked.ok && !hasTag(list, checked.name)) list.push(checked.name)
  }
  return list
}

/** Acrescenta a Tag ao fim da lista, a menos que já exista. */
export function withTag(list: readonly string[], name: string): string[] {
  return hasTag(list, name) ? [...list] : [...list, name]
}

export function withoutTag(list: readonly string[], name: string): string[] {
  const key = tagKey(name)
  return list.filter((item) => tagKey(item) !== key)
}

/** Troca `from` por `to` mantendo a posição; se `to` já estava na lista, as duas viram uma. */
export function renameInList(list: readonly string[], from: string, to: string): string[] {
  const fromKey = tagKey(from)
  const result: string[] = []
  for (const item of list) {
    const next = tagKey(item) === fromKey ? to : item
    if (!hasTag(result, next)) result.push(next)
  }
  return result
}

/** A grafia que já existe para a Tag (a primeira da lista), ou o próprio nome se ela é nova. */
export function canonicalTag(known: readonly string[], name: string): string {
  const key = tagKey(name)
  return known.find((item) => tagKey(item) === key) ?? name
}

function byName(a: TagInfo, b: TagInfo): number {
  return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
}

/**
 * Catálogo efetivo: as Tags do catálogo (inclusive as sem Reunião) mais as que aparecem nas
 * Reuniões, sem repetir. A grafia do catálogo vale; a contagem vem das Reuniões.
 */
export function effectiveTags(catalog: readonly string[], used: readonly TagInfo[]): TagInfo[] {
  const merged = new Map<string, TagInfo>()
  for (const name of catalog) {
    const key = tagKey(name)
    if (!merged.has(key)) merged.set(key, { name, count: 0 })
  }
  for (const item of used) {
    const key = tagKey(item.name)
    const current = merged.get(key)
    if (current) current.count += item.count
    else merged.set(key, { name: item.name, count: item.count })
  }
  return [...merged.values()].sort(byName)
}
