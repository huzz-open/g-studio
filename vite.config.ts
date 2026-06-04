import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'path'
import { createReadStream, existsSync, statSync, copyFileSync, mkdirSync } from 'fs'
import vue from '@vitejs/plugin-vue'

/**
 * Serve opencv.js as a raw static file, bypassing Vite's ESM transformation
 * that breaks Emscripten's inline WASM init. On build, copies to dist/.
 */
function opencvRawServe(): Plugin {
  const src = resolve(__dirname, 'node_modules/@techstark/opencv-js/dist/opencv.js')

  return {
    name: 'opencv-raw-serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/opencv.js') return next()
        if (!existsSync(src)) { res.statusCode = 404; res.end('opencv.js not found'); return }
        const { size } = statSync(src)
        res.setHeader('Content-Type', 'application/javascript')
        res.setHeader('Content-Length', size)
        res.setHeader('Cache-Control', 'max-age=31536000, immutable')
        createReadStream(src).pipe(res)
      })
    },
    closeBundle() {
      if (!existsSync(src)) return
      const outDir = resolve(__dirname, 'dist')
      mkdirSync(outDir, { recursive: true })
      copyFileSync(src, resolve(outDir, 'opencv.js'))
    },
  }
}

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/g-studio/' : '/',
  plugins: [vue(), opencvRawServe()],
})
