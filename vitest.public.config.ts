import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@nova-cbb/harness-contracts': fileURLToPath(
        new URL('./packages/contracts/src/index.ts', import.meta.url),
      ),
      '@nova-cbb/harness-shared': fileURLToPath(
        new URL('./packages/shared/src/index.ts', import.meta.url),
      ),
      '@nova-cbb/source-gitlab': fileURLToPath(
        new URL('./packages/source-gitlab/src/index.ts', import.meta.url),
      ),
      '@nova-cbb/source-npm': fileURLToPath(
        new URL('./packages/source-npm/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/public/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    retry: 1,
    pool: 'forks',
    maxWorkers: 1,
  },
});
