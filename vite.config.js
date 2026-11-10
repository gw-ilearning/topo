import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { mockApiPlugin } from './server/mock-api.js'

export default defineConfig({
  plugins: [vue(), mockApiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
  },
})
