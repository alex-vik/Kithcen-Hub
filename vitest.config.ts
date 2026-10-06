// Набор тестов (ADR-001). Тесты живут в tests/ (зона tester).
// src/smoke.test.ts — единственное исключение: smoke шага 0, его пишет architect.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/smoke.test.ts'],
    environment: 'node',
  },
});
