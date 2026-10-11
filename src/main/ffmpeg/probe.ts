import { execFile } from 'node:child_process'

/** Executa um binário e devolve a saída padrão. Injetável para testes. */
export type RunFn = (file: string, args: string[]) => Promise<{ stdout: string }>

export const runBinary: RunFn = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => (error ? reject(new Error(error.message)) : resolve({ stdout }))
    )
  })

/** `ffmpeg version 9.0.2-full_build-www.gyan.dev Copyright ...` -> `9.0.2-full_build-www.gyan.dev`. */
export function parseVersion(versionOutput: string): string | null {
  return /^\w+ version (\S+)/m.exec(versionOutput)?.[1] ?? null
}

/** Nomes dos encoders listados por `ffmpeg -encoders` (ignora a legenda antes de `------`). */
export function parseEncoders(encodersOutput: string): Set<string> {
  const encoders = new Set<string>()
  let inList = false
  for (const line of encodersOutput.split(/\r?\n/)) {
    if (!inList) {
      if (/^\s*-{3,}\s*$/.test(line)) inList = true
      continue
    }
    const name = /^\s*[VAS][.\w]{5}\s+(\S+)/.exec(line)?.[1]
    if (name) encoders.add(name)
  }
  return encoders
}

export interface FfmpegProbe {
  version: string
  encoders: Set<string>
  hasLibSvtAv1: boolean
}

/** Executa `ffmpeg -version` e `-encoders`. Lança se o binário não rodar ou não reportar versão. */
export async function probeFfmpeg(
  ffmpegPath: string,
  run: RunFn = runBinary
): Promise<FfmpegProbe> {
  const { stdout: versionOut } = await run(ffmpegPath, ['-hide_banner', '-version'])
  const version = parseVersion(versionOut)
  if (!version) throw new Error('Saída de `ffmpeg -version` não reconhecida')
  const { stdout: encodersOut } = await run(ffmpegPath, ['-hide_banner', '-encoders'])
  const encoders = parseEncoders(encodersOut)
  return { version, encoders, hasLibSvtAv1: encoders.has('libsvtav1') }
}

/** Confirma que o `ffprobe` executa (`-version`) e devolve a versão. */
export async function probeFfprobe(ffprobePath: string, run: RunFn = runBinary): Promise<string> {
  const { stdout } = await run(ffprobePath, ['-hide_banner', '-version'])
  const version = parseVersion(stdout)
  if (!version) throw new Error('Saída de `ffprobe -version` não reconhecida')
  return version
}
