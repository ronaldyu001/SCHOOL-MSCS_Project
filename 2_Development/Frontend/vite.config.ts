import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The dev server mirrors nginx.conf in production: both expose the backend at
// /api, so `VITE_API_BASE` never has to change between environments and the
// browser stays same-origin (no CORS preflight, no credentials juggling).
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000'

function desktopBootStatus(): Plugin {
  return {
    name: 'desktop-boot-status',
    configureServer(server) {
      const statusUrl = process.env.BOOT_STATUS_URL
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== 'GET' || request.url?.split('?', 1)[0] !== '/boot') {
          next()
          return
        }

        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        if (statusUrl) {
          try {
            const status = await fetch(statusUrl, { signal: AbortSignal.timeout(1000) })
            if (status.ok) {
              response.end(await status.text())
              return
            }
          } catch {
            // An optional feed can be absent during launcher startup or shutdown.
          }
        }
        response.statusCode = 503
        response.end('{"source":"none"}')
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), desktopBootStatus()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
