import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/g-studio/' : '/',
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('opencv-js-wasm')) return 'opencv'
        },
      },
    },
  },
})
