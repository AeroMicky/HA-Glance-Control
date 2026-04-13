import { defineConfig } from 'vite'
import { readFileSync } from 'fs'

const appJson = JSON.parse(readFileSync('app.json', 'utf-8'))

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(appJson.version),
    __APP_NAME__: JSON.stringify(appJson.name),
  },
})
