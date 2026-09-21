import { defineConfig } from 'vitest/config';

/**
 * The suite is over 900 tests now, and a dozen of them generate hundreds of SECTIONs or step a run
 * for thousands of frames. Each of those finishes in well under a second on its own; run together
 * on a busy machine they were crossing Vitest's 5s default and failing as timeouts, and WHICH ones
 * crossed it changed from run to run -- which is the worst kind of red, because it looks like a
 * flaky assertion when nothing has actually gone wrong.
 *
 * This raises the ceiling and nothing else. No assertion is relaxed and no test is skipped; a test
 * that genuinely hangs still fails, just not because the machine was busy.
 */
export default defineConfig({
  test: {
    testTimeout: 20000,
    hookTimeout: 20000,
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/measure/**'],
  },
});
