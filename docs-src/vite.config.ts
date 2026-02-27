import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/claude-warden/',
  build: {
    outDir: '../docs',
    emptyOutDir: true,
  },
})
