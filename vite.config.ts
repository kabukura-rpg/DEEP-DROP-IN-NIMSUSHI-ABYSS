import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** The commit this build was made from, for the title screen's TEST BUILD tag. */
function buildHash() {
  // GitHub Actions (the Pages build) says which commit it checked out; locally, ask git -- trying the
  // system git by path too, because a stale git earlier on PATH is not something a build should need fixed.
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  for (const git of ['git', '/usr/bin/git', '/opt/homebrew/bin/git']) {
    try { return execSync(`${git} rev-parse --short HEAD`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
    catch { /* try the next one */ }
  }
  return 'local';
}

export default defineConfig({
  base: '/DEEP-DROP-IN-NIMSUSHI-ABYSS/',
  define: {
    __BUILD_HASH__: JSON.stringify(buildHash()),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
});
