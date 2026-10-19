import { createContext } from 'react'

/**
 * Onde tooltips e popovers são desenhados. Em tela cheia só o elemento em tela cheia é
 * visível; por isso o player informa o próprio elemento em vez do `body`.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null)
