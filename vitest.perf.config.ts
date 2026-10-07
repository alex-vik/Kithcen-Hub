// ADR-001, T-008 (НВ-4 б). Замеры: только `npm run perf`, вне `npm test` и Stop-хука.
// Отдельный конфиг, а не mergeConfig с vitest.config.ts: mergeConfig склеивает
// массивы, и include получил бы ещё tests/**/*.test.ts.
import { defineConfig } from 'vitest/config';

// Как в vitest.config.ts: тесты не зависят от пояса машины (NFR-14).
process.env.TZ = 'UTC';

export default defineConfig({
  test: {
    include: ['tests/perf/**/*.perf.ts'],
    environment: 'node',
    retry: 0,
    // Генерация и вставка 500 тыс. событий (ADR-003 §1, §3).
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
