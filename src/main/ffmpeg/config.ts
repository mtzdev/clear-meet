/**
 * Build do FFmpeg fixada pelo app (Windows x64, GPL, com `libsvtav1` e `ffprobe`).
 *
 * Fonte: releases versionadas do GyanD/codexffmpeg (build "full-shared" do gyan.dev).
 * A tag `9.0.2` é imutável e o repositório mantém todas as versões antigas
 * (centenas de releases desde 2020); por isso a URL é durável.
 * O SHA-256 vem do campo `digest` da própria release no GitHub e foi conferido
 * localmente após o download (ver `npm run fetch:ffmpeg`).
 *
 * Para atualizar: troque `version`, `url`, `sha256` e `size` juntos.
 * Variante "shared": `ffmpeg.exe`/`ffprobe.exe` pequenos + DLLs (~100 MB de download,
 * contra ~257 MB da variante estática). As DLLs precisam ficar ao lado dos executáveis.
 */
export interface FfmpegBuild {
  version: string
  url: string
  /** SHA-256 do arquivo .zip, em hexadecimal minúsculo. */
  sha256: string
  /** Tamanho do .zip em bytes. */
  size: number
}

export const FFMPEG_BUILD: FfmpegBuild = {
  version: '9.0.2',
  url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-full_build-shared.zip',
  sha256: '8d31e162f1616e37aab3fa2db991b97e1b8dbeb1c8465fd81a81be16ff91b328',
  size: 99_899_672
}

export const FFMPEG_EXE = 'ffmpeg.exe'
export const FFPROBE_EXE = 'ffprobe.exe'
export const FFMPEG_LICENSE_FILE = 'LICENSE.txt'

/**
 * Decide o que extrair do zip da build: `ffmpeg.exe`, `ffprobe.exe`, as DLLs de
 * `bin/` e a licença. Devolve o nome do arquivo de destino (sempre sem diretório)
 * ou `null` para ignorar a entrada (ffplay, docs, presets, cabeçalhos…).
 */
export function selectArchiveEntry(entryName: string): string | null {
  const path = entryName.replaceAll('\\', '/')
  const bin = /^[^/]+\/bin\/([^/]+)$/.exec(path)
  if (bin) {
    const name = bin[1]
    if (name === undefined) return null
    const lower = name.toLowerCase()
    if (lower === FFMPEG_EXE || lower === FFPROBE_EXE || lower.endsWith('.dll')) return name
    return null
  }
  if (/^[^/]+\/LICENSE$/.test(path)) return FFMPEG_LICENSE_FILE
  return null
}
