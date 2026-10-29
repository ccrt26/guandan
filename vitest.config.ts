import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'lab/tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
