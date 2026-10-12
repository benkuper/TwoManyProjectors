import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
export default defineConfig({
  plugins: [svelte()],
  base: './',
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
  build: { chunkSizeWarningLimit: 1800 }
})
