import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.vite/**',
      'apps/hub-admin/auto-imports.d.ts',
      'apps/hub-admin/components.d.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest*.config.ts', 'tests/public/*.ts', 'tests/integration/*.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['tests/public/*.ts', 'tests/integration/*.ts'],
  },
  {
    files: ['**/*.config.js', '**/*.config.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  {
    files: ['apps/hub-admin/src/main.ts'],
    rules: { '@typescript-eslint/no-unsafe-argument': 'off' },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['prisma/seed.ts'],
  },
);
