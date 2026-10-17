import { spawn } from 'node:child_process'
import { constants, setPriority } from 'node:os'

export interface CompressionResult {
  /** Código de saída; `null` se o processo nem iniciou ou foi interrompido. */
  code: number | null
  stderr: string
  /** Interrompido por `signal` (a gravação começou, o app vai fechar...). */
  aborted: boolean
}

export interface CompressionOptions {
  signal: AbortSignal
  /** Tempo de vídeo já processado, em ms. */
  onProgress(processedMs: number): void
}

/** Executa o FFmpeg da Compactação. Injetável para testes. */
export type RunCompression = (
  file: string,
  args: string[],
  options: CompressionOptions
) => Promise<CompressionResult>

const STDERR_TAIL_CHARS = 4000

/** `out_time_us=123456` das linhas de `-progress`. */
export function parseProgressLine(line: string): number | null {
  const match = /^out_time_us=(\d+)$/.exec(line.trim())
  if (!match?.[1]) return null
  return Math.round(Number(match[1]) / 1000)
}

/** Roda o FFmpeg com prioridade abaixo do normal para não atrapalhar o resto da máquina. */
export const runCompression: RunCompression = (file, args, options) =>
  new Promise((resolve) => {
    if (options.signal.aborted) return resolve({ code: null, stderr: '', aborted: true })
    const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let pending = ''
    let settled = false
    const finish = (result: CompressionResult): void => {
      if (settled) return
      settled = true
      options.signal.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const onAbort = (): void => {
      child.kill()
    }
    options.signal.addEventListener('abort', onAbort, { once: true })

    if (child.pid !== undefined) {
      try {
        setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL)
      } catch {
        // sem permissão para mudar a prioridade: segue com a padrão
      }
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      pending += chunk
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const processed = parseProgressLine(line)
        if (processed !== null) options.onProgress(processed)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL_CHARS)
    })
    child.on('error', (error) => {
      finish({ code: null, stderr: stderr || error.message, aborted: options.signal.aborted })
    })
    child.on('close', (code) => {
      finish({ code, stderr, aborted: options.signal.aborted })
    })
  })
