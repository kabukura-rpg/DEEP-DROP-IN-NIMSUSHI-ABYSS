import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** The commit this build was made from, for the title screen's TEST BUILD tag. */
function buildHash() {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return 'local'; }
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
