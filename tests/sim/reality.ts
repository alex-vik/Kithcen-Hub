// T-006 К5, К6: генератор реального расхода дома («правда», которую система не видит).
// Только обычные недели: календарь гостей и отъездов профиля игнорируется до B-05 (НВ-3).
// Модуль не зависит от прогона (T-007): публичный вход для T-008 — он и rng.ts.
// У каждой позиции свой генератор (сид = f(seed, productId)): правка профиля не перетасовывает остальные.
import type { Instant, LocalDate } from '../../src/domain/time.ts';
import { DEFAULT_SEED, PERIOD_DAYS, PERIOD_START, RHYTHMIC_CV, SLOW_GAP_JITTER, SLOW_USES_PER_PACK, USE_SIZE_CV } from './config.ts';
import { addDays, localToInstant } from './local-time.ts';
import type { HomeProfile } from './profile.ts';
import { createRng, seedFor, type Rng } from './rng.ts';

export type ConsumptionFact = { productId: string; at: Instant; quantity: number };

export type RealityOptions = { seed?: number; startDate?: LocalDate; days?: number };

const hhmm = (hour: number, minute: number): string => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
const atHour = (rng: Rng, date: LocalDate, hour: number): Instant => localToInstant(date, hhmm(hour, Math.floor(rng.next() * 60)));
const whole = (x: number): number => Math.max(1, Math.round(x));

export function generateReality(profile: Pick<HomeProfile, 'products'>, options: RealityOptions = {}): ConsumptionFact[] {
  const { seed = DEFAULT_SEED, startDate = PERIOD_START, days = PERIOD_DAYS } = options;
  const facts: ConsumptionFact[] = [];

  for (const { input, usage } of profile.products) {
    const productId = input.id;
    const rng = createRng(seedFor(seed, productId));
    if (usage.kind === 'rhythmic') {
      const n = usage.slotHours.length;
      for (let d = 0; d < days; d++) {
        const date = addDays(startDate, d);
        const total = whole(usage.dailyUnits * (1 + RHYTHMIC_CV * rng.gauss()));
        const slots = total < n ? usage.slotHours.slice(0, 1) : usage.slotHours;
        const base = Math.floor(total / slots.length);
        slots.forEach((hour, i) => {
          const quantity = i === slots.length - 1 ? total - base * (slots.length - 1) : base;
          facts.push({ productId, at: atHour(rng, date, hour), quantity });
        });
      }
    } else if (usage.kind === 'burst') {
      const p = Math.min(1, usage.usesPerWeek / 7);
      for (let d = 0; d < days; d++) {
        if (rng.next() >= p) continue;
        const date = addDays(startDate, d);
        const quantity = whole(usage.unitsPerUse * (1 + USE_SIZE_CV * rng.gauss()));
        facts.push({ productId, at: atHour(rng, date, 17 + Math.floor(rng.next() * 4)), quantity });
      }
    } else {
      const gap = usage.packLifeDays / SLOW_USES_PER_PACK;
      const size = input.unitsPerPack / SLOW_USES_PER_PACK;
      for (let t = rng.next() * gap; t < days; t += gap * (1 + SLOW_GAP_JITTER * (2 * rng.next() - 1))) {
        const date = addDays(startDate, Math.floor(t));
        const quantity = whole(size * (1 + USE_SIZE_CV * rng.gauss()));
        facts.push({ productId, at: atHour(rng, date, 8 + Math.floor(rng.next() * 14)), quantity });
      }
    }
  }

  return facts.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
}
