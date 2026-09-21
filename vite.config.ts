import { defineConfig } from 'vite';

export default defineConfig({
  base: '/DEEP-DROP-IN-NIMSUSHI-ABYSS/',
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
