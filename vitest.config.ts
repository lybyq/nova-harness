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
      '@nova-cbb/harness-core': fileURLToPath(
        new URL('./packages/core/src/index.ts', import.meta.url),
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
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/public/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'packages/core/src/planner.ts',
        'packages/core/src/profile-merge.ts',
        'packages/core/src/resolver.ts',
      ],
      thresholds: {
        lines: 85,
        branches: 80,
      },
    },
  },
});
