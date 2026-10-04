import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' so the built bundle works from any folder / file server
export default defineConfig({
  base: './',
  // inline fonts as data URIs so the single-file / desktop builds stay fully offline
  build: { assetsInlineLimit: 100000000 },
  plugins: [react()],
})
