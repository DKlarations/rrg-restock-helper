import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

// Isolated local QA: no proxies; optional root selects the verified source backup.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const root = process.env.MOTION_QA_ROOT ? resolve(process.env.MOTION_QA_ROOT) : repository
export default {
  root,
  plugins: [react()],
  cacheDir: resolve(repository, 'tmp', root === repository ? 'motion-updated-cache' : 'motion-baseline-cache'),
  optimizeDeps: { entries: ['index.html'] },
  server: {
    host: '127.0.0.1', strictPort: true,
    fs: { allow: [root, resolve(repository, 'node_modules')] },
    watch: { ignored: ['**/tmp/motion*/**'] },
  },
}
