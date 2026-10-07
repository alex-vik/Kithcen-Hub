// T-007 К12, Q-31: G-1 по реальности. Случай — эпизод «нужно, а нет» по одной позиции: начинается первым
// неудовлетворённым спросом, кончается ближайшей плановой закупкой (по расписанию),
// куплена позиция или нет; нехватка после закупки — новый случай. Частичная нехватка считается. Позиция-сутки — диагностика.
import type { Instant, LocalDate } from '../../src/domain/time.ts';
import { MONTH_DAYS, WORST_WINDOW_DAYS } from './run-config.ts';
import { localDateOf } from './local-time.ts';

export type UnmetEntry = { productId: string; at: Instant; quantity: number };
export type PurchaseMark = { productId: string; at: Instant };
export type G1Result = { cases: number; perMonth: number; worst90: number; unmetProductDays: number };

const dayNumber = (d: LocalDate): number => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

export function computeG1(input: {
  unmet: readonly UnmetEntry[];
  /** Моменты плановых закупок (общее расписание). */
  schedule: readonly Instant[];
  startDate: LocalDate;
  days: number;
}): G1Result {
  const { unmet, schedule, startDate, days } = input;
  const startDay = dayNumber(startDate);
  const episodeStarts: number[] = [];
  const productDays = new Set<string>();
  const byProduct = new Map<string, UnmetEntry[]>();
  for (const u of unmet) {
    if (u.quantity <= 0) continue;
    productDays.add(`${u.productId}|${localDateOf(u.at)}`);
    byProduct.set(u.productId, [...(byProduct.get(u.productId) ?? []), u]);
  }
  for (const list of byProduct.values()) {
    const sorted = [...list].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    let prev: UnmetEntry | undefined;
    for (const e of sorted) {
      const ended = prev !== undefined && schedule.some((b) => b > prev!.at && b <= e.at);
      if (prev === undefined || ended) episodeStarts.push(dayNumber(localDateOf(e.at)) - startDay);
      prev = e;
    }
  }
  let worst90 = 0;
  for (let s = 0; s <= Math.max(0, days - WORST_WINDOW_DAYS); s++) {
    worst90 = Math.max(worst90, episodeStarts.filter((d) => d >= s && d < s + WORST_WINDOW_DAYS).length);
  }
  return {
    cases: episodeStarts.length,
    perMonth: (episodeStarts.length * MONTH_DAYS) / days,
    worst90,
    unmetProductDays: productDays.size,
  };
}
