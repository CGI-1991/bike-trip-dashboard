import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

import { offlineResources } from './scripts/offline-resources.mjs'

function offlineServiceWorkerPlugin() {
  let projectRoot = ''

  return {
    name: 'bike-trip-offline-service-worker',
    configResolved(config) {
      projectRoot = config.root
    },
    generateBundle(_options, bundle) {
      const buildAssets = Object.keys(bundle)
        .filter((fileName) => fileName.startsWith('assets/'))
        .sort()
      const templatePath = resolve(projectRoot, 'scripts/service-worker.template.js')
      const template = readFileSync(templatePath, 'utf8')
      const hash = createHash('sha256')
      hash.update(template)
      hash.update(JSON.stringify(buildAssets))
      hash.update(JSON.stringify(offlineResources))

      for (const resource of offlineResources) {
        hash.update(readFileSync(resolve(projectRoot, 'public', resource)))
      }

      const cacheVersion = hash.digest('hex').slice(0, 12)
      const source = template
        .replace('__CACHE_VERSION__', cacheVersion)
        .replace('__BUILD_ASSETS__', JSON.stringify(buildAssets))
        .replace('__OFFLINE_RESOURCES__', JSON.stringify(offlineResources))

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source,
      })
    },
  }
}

export default defineConfig({
  base: '/bike-trip-dashboard/',
  plugins: [offlineServiceWorkerPlugin()],
  server: {
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
})
