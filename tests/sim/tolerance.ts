// T-006 К6: допуски по σ, не по фиксированной доле: у редких позиций относительный разброс велик.
import { PERIOD_DAYS, SIGMA_K, SLOW_GAP_JITTER, SLOW_USES_PER_PACK, USE_SIZE_CV } from './config.ts';
import type { Usage } from './profile.ts';

/** Рывковая: число использований за days суток — биномиальное (день с вероятностью p). Допуск SIGMA_K·σ, абсолютный. */
export function burstCountTolerance(usage: Extract<Usage, { kind: 'burst' }>, days: number = PERIOD_DAYS): number {
  const p = Math.min(1, usage.usesPerWeek / 7);
  return SIGMA_K * Math.sqrt(days * p * (1 - p));
}

/**
 * Медленная: допуск суммарного расхода, абсолютный. Относительный σ = sqrt((cv интервала² + cv размера²) / n),
 * n — ожидаемое число использований; плюс 1/n на краевой эффект (случайный сдвиг начала в пределах одного интервала).
 */
export function slowSumTolerance(expected: number, packLifeDays: number, days: number = PERIOD_DAYS): number {
  const n = days / (packLifeDays / SLOW_USES_PER_PACK);
  const cvGap = SLOW_GAP_JITTER / Math.sqrt(3);
  return expected * (SIGMA_K * Math.sqrt((cvGap ** 2 + USE_SIZE_CV ** 2) / n) + 1 / n);
}
