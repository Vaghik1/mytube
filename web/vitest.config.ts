import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __BUILD__: JSON.stringify('test') },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
  },
});
