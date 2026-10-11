import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initTheme } from '@/lib/theme'
import '@/styles/globals.css'
import { FloatingBar } from './bar'
import { NoteEditor } from './note-editor'

// Uma página, duas janelas: o main carrega `floating.html#bar` e `floating.html#note`.
initTheme({ colorScheme: false })

const root = document.getElementById('root')
if (!root) throw new Error('Elemento #root não encontrado')

createRoot(root).render(
  <StrictMode>{window.location.hash === '#note' ? <NoteEditor /> : <FloatingBar />}</StrictMode>
)
