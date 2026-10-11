import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        // O preload sandboxed não pode carregar chunks: cada entrada é um arquivo único,
        // sem módulos em comum (a janela de gravação tem o próprio preload).
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          recorder: resolve(__dirname, 'src/preload/recorder.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': shared
      }
    },
    build: {
      minify: 'esbuild',
      rollupOptions: {
        // Duas páginas: a UI e a janela de gravação (oculta).
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          recorder: resolve(__dirname, 'src/renderer/recorder.html')
        }
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
