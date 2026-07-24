import { defineConfig } from 'vite'

export default defineConfig({
  base: '/rga-2026-dashboard/',
  server: {
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
})
