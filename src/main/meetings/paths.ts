import { resolve } from 'node:path'

/** Duas formas de escrever a mesma pasta? (Windows ignora maiúsculas e minúsculas.) */
export function sameFolder(a: string, b: string): boolean {
  const left = resolve(a)
  const right = resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}
