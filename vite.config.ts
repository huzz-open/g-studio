import { defineConfig, type Plugin } from 'vite'
import { resolve } from 'path'
import { createReadStream, existsSync, statSync, copyFileSync, mkdirSync, readFileSync } from 'fs'
import vue from '@vitejs/plugin-vue'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

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
        if (req.url?.split('?')[0] !== '/opencv.js') return next()
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


function generationDevelopmentConnection(): Plugin {
  return {name:'generation-development-connection',configureServer(server){
    server.middlewares.use((req,res,next)=>{
      if(req.url!=='/__generation/connection')return next()
      const address=req.socket.remoteAddress,origin=req.headers.origin
      if(req.method!=='GET'||! /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host||'')||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address||'') || (origin && origin!==`http://${req.headers.host}`) || !['same-origin','none',undefined].includes(req.headers['sec-fetch-site'] as string|undefined)) {res.statusCode=403;res.end();return}
      try{const home=process.env.GEN_DATA_HOME||process.env.GEN_HOME||resolve(__dirname,'runtime/generation-data'),config=JSON.parse(readFileSync(resolve(home,'config.json'),'utf8'));res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({baseUrl:`http://127.0.0.1:${process.env.GEN_PORT||8765}`,token:config.token}))}
      catch{res.statusCode=503;res.end('Generation service is preparing')}
    })
  }}
}

export default defineConfig({
  optimizeDeps: { entries: ['index.html'] },
  server: { watch: { ignored: ['**/runtime/**', '**/.generation-test/**', '**/.venv/**', '**/venv/**'] } },
  base: process.env.GITHUB_ACTIONS ? '/g-studio/' : '/',
  plugins: [vue(), opencvRawServe(), generationDevelopmentConnection()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
