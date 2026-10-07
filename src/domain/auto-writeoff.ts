// T-010, FR-CON-01, BR-09, BR-10, BR-27: что и сколько автосписывается за сутки. Чистая функция, без часов.
import { isAbsenceDay } from './absence.ts';
import type { AbsencePeriod } from './absence.ts';
import { isActive } from './catalog.ts';
import type { Product, StateEvent } from './catalog.ts';
import { dayBounds } from './time.ts';
import type { Instant, LocalDate, TimeZone } from './time.ts';

export type AutoWriteoffParams = { timeZone: TimeZone; autoWriteoffTime: string };
export type AutoWriteoff = { productId: string; quantity: number; key: string; occurredAt: Instant };

export const autoWriteoffKey = (productId: string, day: LocalDate): string => `auto_writeoff:${productId}:${day}`;

/** Только rhythmic с нормой, активные на конец суток D; одна суточная норма на сутки любой длины. */
export function autoWriteoffsForDay(
  day: LocalDate,
  entries: readonly { product: Product; stateEvents: readonly StateEvent[] }[],
  params: AutoWriteoffParams,
  absences: readonly AbsencePeriod[],
): AutoWriteoff[] {
  if (isAbsenceDay(day, absences)) return []; // T-012, FR-ABS-03
  const { start, end } = dayBounds(day, params.timeZone);
  const out: AutoWriteoff[] = [];
  for (const { product, stateEvents } of entries) {
    if (product.writeOffType !== 'rhythmic' || product.norm === null) continue;
    if (!isActive(stateEvents.filter((e) => e.occurredAt < end))) continue;
    out.push({ productId: product.id, quantity: product.norm, key: autoWriteoffKey(product.id, day), occurredAt: start });
  }
  return out;
}
