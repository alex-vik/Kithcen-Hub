// Общие данные тестов журнала остатка (T-002, переведены на T-003). Время фиксировано и передаётся явно (ADR-004, 14.4).
import type { StockFoldEvent, StockEventType } from '../../src/domain/index.ts';

export const iso = (s: string): number => Temporal.Instant.from(s).epochMilliseconds;

// Событие для чистой свёртки: явные seq и occurredAt (мс UTC).
export function fe(
  id: string,
  type: StockEventType,
  qty: number | null,
  at: string,
  seq: number,
): StockFoldEvent {
  return { id, type, qty, occurredAt: iso(at), seq };
}

// Молоко из T-003 К5. Порядок seq — порядок записи.
export const milkEvents = (): StockFoldEvent[] => [
  fe('e1', 'purchase', 6, '2026-10-03T10:00:00Z', 1),
  fe('e2', 'used', 1, '2026-10-04T08:00:00Z', 2),
  fe('e3', 'recount', 3, '2026-10-04T21:00:00Z', 3),
  fe('e4', 'used', 1, '2026-10-05T09:00:00Z', 4),
];
// Задним числом до «пересчитал» и после него (К5).
export const usedBefore = (): StockFoldEvent => fe('e5', 'used', 1, '2026-10-04T07:00:00Z', 5);
export const usedAfter = (): StockFoldEvent => fe('e5', 'used', 1, '2026-10-06T20:00:00Z', 5);
