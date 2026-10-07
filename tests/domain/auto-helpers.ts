// T-010: помощники доменных тестов времени и автосписания. Не тест (имя без .test).
// Контракт (docs/tasks/T-010, «Интерфейс»), заданный тестами:
//   src/domain/time.ts: localDateOf(instant, tz), addDays(day, n), dayBounds(day, tz) -> {start, end},
//                       localTimeOn(day, 'HH:MM', tz), pendingDays(cursor, now, {timeZone, autoWriteoffTime}) -> LocalDate[]
//   src/domain/auto-writeoff.ts: autoWriteoffKey(productId, day), autoWriteoffsForDay(day, entries, params)
//                       -> { productId, quantity, key, occurredAt }[]
// Модуль time.ts уже есть (там пока только isInstant): отсутствующие функции дают TypeError в каждом тесте.
// auto-writeoff.ts ещё нет: грузится динамически, чтобы падал тест, а не весь файл.
import * as timeModule from '../../src/domain/time.ts';
import type { Instant, LocalDate, TimeZone } from '../../src/domain/time.ts';
import { createProduct } from '../../src/domain/catalog.ts';
import type { Product, StateEvent, WriteOffType } from '../../src/domain/catalog.ts';

export const VILNIUS = 'Europe/Vilnius';

export type Params = { timeZone: TimeZone; autoWriteoffTime: string };
export const DEFAULTS: Params = { timeZone: VILNIUS, autoWriteoffTime: '00:00' };

export type TimeApi = {
  localDateOf(instant: Instant, tz: TimeZone): LocalDate;
  addDays(day: LocalDate, n: number): LocalDate;
  dayBounds(day: LocalDate, tz: TimeZone): { start: Instant; end: Instant };
  localTimeOn(day: LocalDate, hhmm: string, tz: TimeZone): Instant;
  pendingDays(cursor: LocalDate, now: Instant, params: Params): LocalDate[];
};
export const T = timeModule as unknown as TimeApi;

export type Entry = { product: Product; stateEvents: readonly StateEvent[] };
export type AutoWriteoff = { productId: string; quantity: number; key: string; occurredAt: Instant };
export type AutoApi = {
  autoWriteoffKey(productId: string, day: LocalDate): string;
  autoWriteoffsForDay(day: LocalDate, entries: readonly Entry[], params: Params): AutoWriteoff[];
};
const URL_AUTO = new URL('../../src/domain/auto-writeoff.ts', import.meta.url).href;
export async function auto(): Promise<AutoApi> {
  return (await import(/* @vite-ignore */ URL_AUTO)) as AutoApi;
}

export function prod(id: string, type: WriteOffType, norm: number | null, unit: 'г' | 'мл' | 'шт' = 'мл'): Product {
  const r = createProduct({ id, name: id, unit, packName: 'уп', unitsPerPack: 10, writeOffType: type, norm });
  if (!r.ok) throw new Error(`тест: позиция не создана: ${r.error.attribute}`);
  return r.value;
}

let seq = 0;
export function st(
  productId: string, occurredAt: Instant, state: 'active' | 'inactive',
  reason: StateEvent['reason'] = 'user_button', seqNo: number = ++seq,
): StateEvent {
  return { id: `s-${seqNo}-${productId}`, seq: seqNo, productId, occurredAt, recordedAt: occurredAt, state, reason };
}
