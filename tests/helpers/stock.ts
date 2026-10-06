// Общие данные тестов журнала остатка (T-002). Время фиксировано и передаётся явно (ADR-004, 14.4).
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

// Кофе из ADR-003, раздел 3 (К4). Порядок seq — порядок записи.
export const adrCoffee = (): StockFoldEvent[] => [
  fe('e1', 'purchase', 500, '2026-10-03T10:00:00Z', 1),
  fe('e2', 'auto_writeoff', 20, '2026-10-04T00:00:00Z', 2),
  fe('e3', 'inventory', 450, '2026-10-04T21:00:00Z', 3),
  fe('e4', 'auto_writeoff', 20, '2026-10-05T00:00:00Z', 4),
];
// К5: порция задним числом до инвентаризации; К6: после.
export const portionBefore = (): StockFoldEvent =>
  fe('e5', 'portion', 10, '2026-10-04T08:00:00Z', 5);
export const portionAfter = (): StockFoldEvent =>
  fe('e5', 'portion', 10, '2026-10-05T08:00:00Z', 5);
