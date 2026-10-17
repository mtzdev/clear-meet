import { useSyncExternalStore } from 'react'

/** Áreas do app. "meeting" é o detalhe de uma Reunião (Fase 4). */
export const ROUTES = ['record', 'meetings', 'meeting', 'settings'] as const
export type Route = (typeof ROUTES)[number]

export const DEFAULT_ROUTE: Route = 'record'

function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value)
}

/** `#/meetings` -> `meetings`. Hash vazio ou desconhecido cai na rota padrão. */
export function parseHash(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/, 1)[0] ?? ''
  return isRoute(name) ? name : DEFAULT_ROUTE
}

export function hrefFor(route: Route): string {
  return `#/${route}`
}

/** Parâmetros do hash: `#/meeting?id=abc` -> `id=abc`. */
export function parseHashParams(hash: string): URLSearchParams {
  const query = hash.split('?').slice(1).join('?')
  return new URLSearchParams(query)
}

/**
 * Link para abrir uma Reunião pelo `id` do `meeting.json` (estável mesmo se a pasta for
 * renomeada). Com `startMs`, o player abre já nesse Instante.
 */
export function meetingHref(id: string, startMs?: number | null): string {
  const start =
    typeof startMs === 'number' && Number.isFinite(startMs) && startMs >= 0
      ? `&t=${Math.round(startMs)}`
      : ''
  return `${hrefFor('meeting')}?id=${encodeURIComponent(id)}${start}`
}

/** `id` da Reunião aberta no hash, ou `null`. */
export function parseMeetingId(hash: string): string | null {
  if (parseHash(hash) !== 'meeting') return null
  const id = parseHashParams(hash).get('id')
  return id !== null && id !== '' ? id : null
}

/** Instante (ms) em que a Reunião aberta deve começar (`&t=`), ou `null`. */
export function parseMeetingStart(hash: string): number | null {
  if (parseHash(hash) !== 'meeting') return null
  const raw = parseHashParams(hash).get('t')
  if (raw === null || !/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

export function openMeeting(id: string, startMs?: number | null): void {
  window.location.hash = meetingHref(id, startMs)
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route)
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

/** Rota atual, derivada do hash da URL (sem biblioteca de roteamento). */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return parseHash(hash)
}

/** `id` da Reunião aberta (rota `#/meeting?id=...`). */
export function useMeetingId(): string | null {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return parseMeetingId(hash)
}

/** Instante inicial pedido na rota (`&t=...`), em ms. */
export function useMeetingStart(): number | null {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return parseMeetingStart(hash)
}
