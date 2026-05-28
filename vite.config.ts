import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The browser talks only to our backend proxy (port 8787); the OpenRAG token
// never reaches the client. In dev, Vite forwards /api to that proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
})
