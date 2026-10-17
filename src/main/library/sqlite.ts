import type * as Sqlite from 'node:sqlite'

export type SqliteModule = typeof Sqlite
export type Database = Sqlite.DatabaseSync

/**
 * Carrega `node:sqlite` sem o aviso "experimental" no console. O aviso é emitido no momento do
 * carregamento, por isso o módulo não pode ser importado de forma estática; só esse aviso é
 * filtrado, os demais seguem normalmente.
 */
export async function loadSqlite(): Promise<SqliteModule> {
  const original = process.emitWarning.bind(process)
  process.emitWarning = (warning: string | Error, ...args: unknown[]) => {
    const type =
      typeof args[0] === 'string' ? args[0] : (args[0] as { type?: string } | undefined)?.type
    const message = typeof warning === 'string' ? warning : warning.message
    if (type === 'ExperimentalWarning' && /sqlite/i.test(message)) return
    return Reflect.apply(original, process, [warning, ...args]) as void
  }
  try {
    return await import('node:sqlite')
  } finally {
    process.emitWarning = original
  }
}
