// T-012: помощники доменных тестов отпуска. Не тест (имя без .test).
// Контракт (docs/tasks/T-012, «Интерфейс»), заданный тестами:
//   src/domain/time.ts:    isLocalDate(v: unknown): v is LocalDate
//   src/domain/absence.ts: AbsencePeriod { id, start, end, recordedAt }; createAbsencePeriod(input): Result<AbsencePeriod>;
//                          isAbsenceDay(day, periods): boolean; absenceCancelKey(targetId): string;
//                          absenceCancels(period, events, timeZone): { productId, targetId, key }[]
// absence.ts ещё нет: грузится динамически, чтобы падал тест, а не весь файл.
import type { Result } from '../../src/domain/catalog.ts';
import { createStockEvent } from '../../src/domain/journal.ts';
import type { StockEvent, StockEventInput } from '../../src/domain/journal.ts';
import type { Instant, LocalDate } from '../../src/domain/time.ts';
import { dayBounds, isInstant } from '../../src/domain/time.ts';
import * as timeModule from '../../src/domain/time.ts';
import { prod, VILNIUS } from './auto-helpers.ts';

export { VILNIUS };
export type Period = { id: string; start: LocalDate; end: LocalDate; recordedAt: Instant };
export type Cancel = { productId: string; targetId: string; key: string };
export type AbsenceApi = {
  createAbsencePeriod(input: unknown): Result<Period>;
  isAbsenceDay(day: LocalDate, periods: readonly Period[]): boolean;
  absenceCancelKey(targetId: string): string;
  absenceCancels(period: Period, events: readonly StockEvent[], timeZone: string): Cancel[];
};
const URL_ABS = new URL('../../src/domain/absence.ts', import.meta.url).href;
export async function absence(): Promise<AbsenceApi> {
  return (await import(/* @vite-ignore */ URL_ABS)) as AbsenceApi;
}
export const isLocalDate = (v: unknown): boolean =>
  (timeModule as unknown as { isLocalDate(v: unknown): boolean }).isLocalDate(v);

export const REC = '2026-10-15T06:00:00.000Z';
export const period = (start: LocalDate, end: LocalDate, id = 'ab-1'): Period => ({ id, start, end, recordedAt: REC });

export const P = prod('P', 'rhythmic', 20, 'г');
export const Q = prod('Q', 'rhythmic', 1, 'шт');

/** Событие через домен; seq и время задаются явно. */
export function ev(p: typeof P, id: string, seq: number, kind: StockEventInput['kind'], occurredAt: Instant, extra: Partial<StockEventInput> = {}): StockEvent {
  const r = createStockEvent(p, { id, seq, kind, occurredAt, recordedAt: REC, source: 'test', ...extra });
  if (!r.ok) throw new Error(`тест: событие не создано: ${r.error.attribute}`);
  return r.value;
}
/** Автосписание за сутки D: occurredAt = начало суток по Вильнюсу. */
export const autoEv = (p: typeof P, seq: number, day: LocalDate): StockEvent =>
  ev(p, `a-${p.id}-${day}`, seq, 'auto_writeoff', dayBounds(day, VILNIUS).start, { quantity: p.norm ?? 1, source: 'auto_writeoff' });
export const autoId = (p: typeof P, day: LocalDate): string => `a-${p.id}-${day}`;

/** Журнал Д5: автосписания P и Q за 10-09…10-14; у Q seq меньше, чем у P, на тех же сутках. */
export const DAYS = ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'] as const;
export function baseJournal(): StockEvent[] {
  const out: StockEvent[] = [];
  DAYS.forEach((d, i) => {
    out.push(autoEv(Q, 100 + i * 2, d));
    out.push(autoEv(P, 101 + i * 2, d));
  });
  out.push(ev(P, 'portion-1', 200, 'portion', '2026-10-11T09:00:00.000Z', { quantity: 5 }));
  out.push(ev(P, 'inv-1', 201, 'inventory', '2026-10-12T19:00:00.000Z', { value: 480 }));
  out.push(ev(P, 'buy-1', 202, 'purchase', '2026-10-11T06:00:00.000Z', { quantity: 100 }));
  return out;
}

export function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
export { isInstant };
