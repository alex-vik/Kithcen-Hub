// ADR-001 (B-00a): один раннер для домена, приёмочных тестов, симулятора и клиента.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
