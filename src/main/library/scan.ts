import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { MEETING_FILES } from '@shared/meeting'
import { isStagingName } from '../meetings/repository'

export interface FolderScan {
  /** Tamanho e data de cada arquivo da pasta (sem subpastas). */
  files: Map<string, { size: number; mtimeMs: number }>
  /** Muda quando qualquer arquivo é criado, apagado ou alterado. */
  signature: string
  /** Soma dos tamanhos dos arquivos. */
  sizeBytes: number
  /** Assinatura do `video.mp4`; `null` sem Vídeo. */
  videoSig: string | null
}

/**
 * Temporários que aparecem e somem sem que a Reunião tenha mudado: a escrita atômica e o Vídeo
 * compactado em construção (que cresce durante a Compactação e ainda não faz parte da Reunião).
 */
function isTemporary(name: string): boolean {
  return name.endsWith('.tmp') || name === MEETING_FILES.videoCompacting
}

/** Lê só os metadados dos arquivos da pasta (nunca o conteúdo). `null` se a pasta não existe mais. */
export async function scanFolder(folder: string): Promise<FolderScan | null> {
  let names: string[]
  try {
    const entries = await readdir(folder, { withFileTypes: true })
    names = entries
      .filter((entry) => entry.isFile() && !isTemporary(entry.name))
      .map((entry) => entry.name)
  } catch {
    return null
  }
  const stats = await Promise.all(
    names.map(async (name) => {
      try {
        const info = await stat(join(folder, name))
        return { name, size: info.size, mtimeMs: Math.floor(info.mtimeMs) }
      } catch {
        return null
      }
    })
  )
  const files = new Map<string, { size: number; mtimeMs: number }>()
  let sizeBytes = 0
  for (const item of stats) {
    if (!item) continue
    files.set(item.name, { size: item.size, mtimeMs: item.mtimeMs })
    sizeBytes += item.size
  }
  const signature = [...files.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, info]) => `${name}:${info.size}:${info.mtimeMs}`)
    .join('|')
  const video = files.get(MEETING_FILES.video)
  return {
    files,
    signature,
    sizeBytes,
    videoSig: video ? `${video.size}:${video.mtimeMs}` : null
  }
}

/** Nomes das pastas diretamente dentro de `root`. Raiz inexistente = lista vazia. */
export async function listFolderNames(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !isStagingName(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}
