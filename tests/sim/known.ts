// T-007 К9, ADR-003 §5.1: «что система знала к моменту T» — события с recordedAt <= T, свёртка с asOf = T.
// Остаток считает домен (BR-01); симулятор его не считает и не обрезает снизу (BR-15).
import type { StockEvent } from '../../src/domain/journal.ts';
import { stockBalance } from '../../src/domain/journal.ts';
import type { Instant } from '../../src/domain/time.ts';

export const knownEvents = (events: readonly StockEvent[], at: Instant): StockEvent[] =>
  events.filter((e) => e.recordedAt <= at);

export const systemBalanceAt = (events: readonly StockEvent[], at: Instant): number =>
  stockBalance(knownEvents(events, at), at);
