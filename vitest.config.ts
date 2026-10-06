// ADR-001. Единый раннер для всех тестов, включая симулятор tests/sim/.
import { defineConfig } from 'vitest/config';

// Сервер хранит время в UTC (NFR-14). Тесты не должны зависеть от пояса машины:
// код, который молча опирается на системный пояс вместо явного Europe/Vilnius,
// здесь проявится. Воркеры наследуют переменную окружения.
process.env.TZ = 'UTC';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Детерминизм: без повторов, падение — сигнал, а не шум.
    retry: 0,
  },
});
