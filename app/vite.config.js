import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// O site é servido pelo GitHub Pages a partir da raiz do repositório.
// `npm run deploy` compila para app/dist e copia para a raiz (publish.mjs).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
})
