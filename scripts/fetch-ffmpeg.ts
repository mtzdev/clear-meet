/**
 * Baixa o FFmpeg fixado para `vendor/ffmpeg/<versão>/` (uso em desenvolvimento).
 * Usa exatamente o mesmo módulo que o app usará na primeira execução.
 *
 *   npm run fetch:ffmpeg            # baixa se ainda não estiver instalado
 *   npm run fetch:ffmpeg -- --force # baixa e reinstala
 */
import { join, resolve } from 'node:path'
import {
  FFMPEG_BUILD,
  getFfmpegStatus,
  installFfmpeg,
  type InstallProgress
} from '../src/main/ffmpeg'

const root = resolve(__dirname, '..')
const vendorRoot = join(root, 'vendor', 'ffmpeg')
const force = process.argv.includes('--force')

const megabytes = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1)

let lastLine = 0
function report(progress: InstallProgress): void {
  if (progress.phase === 'download') {
    const now = Date.now()
    if (now - lastLine < 500 && progress.receivedBytes !== progress.totalBytes) return
    lastLine = now
    const total = progress.totalBytes
    const percent = total ? ` (${((progress.receivedBytes / total) * 100).toFixed(0)}%)` : ''
    process.stdout.write(
      `\rBaixando ${megabytes(progress.receivedBytes)} / ${total ? megabytes(total) : '?'} MB${percent}   `
    )
    return
  }
  const labels = {
    verify: 'Verificando SHA-256...',
    extract: 'Extraindo ffmpeg.exe, ffprobe.exe, DLLs e licença...',
    validate: 'Validando (-version, -encoders, ffprobe)...',
    done: 'Concluído.'
  } as const
  process.stdout.write(`\n${labels[progress.phase]}`)
}

async function main(): Promise<void> {
  console.log(`FFmpeg ${FFMPEG_BUILD.version}`)
  console.log(`Fonte:    ${FFMPEG_BUILD.url}`)
  console.log(`SHA-256:  ${FFMPEG_BUILD.sha256}`)
  console.log(`Destino:  ${vendorRoot}`)
  const started = Date.now()
  const result = await installFfmpeg({ destRoot: vendorRoot, force, onProgress: report })
  console.log(
    result.installed
      ? `\nInstalado em ${result.dir} (${((Date.now() - started) / 1000).toFixed(1)} s).`
      : `\nJá instalado em ${result.dir}; nada a fazer (use --force para reinstalar).`
  )

  const status = await getFfmpegStatus({ env: {}, downloadedRoot: join(root, '.none'), vendorRoot })
  console.log('\nStatus:')
  console.log(`  disponível:  ${status.available}`)
  console.log(`  versão:      ${status.version ?? '-'}`)
  console.log(`  libsvtav1:   ${status.hasLibSvtAv1}`)
  console.log(`  ffmpeg:      ${status.ffmpegPath ?? '-'}`)
  console.log(`  ffprobe:     ${status.ffprobePath ?? '-'}`)
  if (!status.available || !status.hasLibSvtAv1) {
    throw new Error(status.error ?? 'FFmpeg instalado sem libsvtav1')
  }
}

main().catch((error: unknown) => {
  console.error(`\nErro: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
