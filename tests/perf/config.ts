// T-008: параметры стенда замера (ADR-003 §1, §3). В раздел 15 спеки не вносятся.
export const PERF = {
  seed: 20261006,
  products: 200,
  rhythmic: 60,
  /** ADR-003 §1. */
  maxPerProduct: 5000,
  /** Допуск на число событий, доля. */
  tolerance: 0.01,
  /** Полный журнал (npm run perf). */
  fullEvents: 500_000,
  /** Уменьшенный журнал (общий набор npm test). */
  reducedEvents: 20_000,
  /** ADR-003 §3: порог, медиана, мс. */
  thresholdMs: 100,
  warmup: 3,
  repeats: 10,
} as const;
