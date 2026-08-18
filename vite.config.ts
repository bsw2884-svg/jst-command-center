import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'

function localCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

const buildCommit = process.env.VERCEL_GIT_COMMIT_SHA || localCommit()

export default defineConfig({
  define: {
    __JST_BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
})
