import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '_external/**',
      'node_modules/**',
      '**/node_modules/**',
      'runtime/**',
      'proto/**',
      'docs/**',
      'spec/**',
    ],
  },
});
