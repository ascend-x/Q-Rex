import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' so the built bundle works from any folder / file server
export default defineConfig({
  base: './',
  plugins: [react()],
})
