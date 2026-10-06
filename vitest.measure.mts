import { defineConfig } from 'vitest/config';

/**
 * AREA 4 / LIMBO before-after measurement (tests/measure/limbo-gameplay.test.ts). tests/measure is kept
 * out of the ordinary suite by vitest.config.mts; this config runs that one file on its own:
 *
 *   LIMBO_SEEDS=60 LIMBO_PLAY=60 npx vitest run --config vitest.measure.mts
 */
export default defineConfig({ test: { testTimeout: 1_800_000, include: ['tests/measure/limbo-gameplay.test.ts'] } });
