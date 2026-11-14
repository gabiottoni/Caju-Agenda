// Copia o build (app/dist) para a raiz do repositório, que é o que o GitHub Pages serve.
import { cpSync, rmSync, readdirSync, existsSync } from 'node:fs'
const root = new URL('../', import.meta.url).pathname
const dist = new URL('./dist/', import.meta.url).pathname
if (existsSync(root + 'assets')) for (const f of readdirSync(root + 'assets')) rmSync(root + 'assets/' + f)
cpSync(dist, root, { recursive: true })
console.log('Publicado na raiz do repositório.')
