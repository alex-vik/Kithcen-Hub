// T-012, FR-ABS-01…04, BR-02, BR-27, ADR-005 «Отпуск задним числом». Чистые функции, без часов.
import type { Result } from './catalog.ts';
import { cancelledIds } from './journal.ts';
import type { StockEvent } from './journal.ts';
import { isInstant, isLocalDate, localDateOf } from './time.ts';
import type { Instant, LocalDate, TimeZone } from './time.ts';

/** Обе даты включительно. */
export type AbsencePeriod = { id: string; start: LocalDate; end: LocalDate; recordedAt: Instant };

const fail = (attribute: string, message: string): Result<never> => ({
  ok: false,
  error: { attribute, code: 'invalid', message },
});

export function createAbsencePeriod(input: {
  id: unknown; start: unknown; end: unknown; recordedAt: unknown;
}): Result<AbsencePeriod> {
  const { id, start, end, recordedAt } = input;
  if (typeof id !== 'string' || id.trim() === '') return fail('id', 'id не может быть пустым');
  if (!isLocalDate(start)) return fail('start', 'начало должно быть датой YYYY-MM-DD');
  if (!isLocalDate(end) || end < start) return fail('end', 'окончание должно быть датой не раньше начала');
  if (!isInstant(recordedAt)) return fail('recordedAt', 'время записи должно быть моментом UTC');
  return { ok: true, value: { id, start, end, recordedAt } };
}

export function isAbsenceDay(day: LocalDate, periods: readonly AbsencePeriod[]): boolean {
  return periods.some((p) => p.start <= day && day <= p.end);
}

export const absenceCancelKey = (targetId: string): string => `absence_cancel:${targetId}`;

/** FR-ABS-04: действующие автосписания, сутки которых попадают в период, по возрастанию seq. */
export function absenceCancels(
  period: AbsencePeriod,
  events: readonly StockEvent[],
  timeZone: TimeZone,
): { productId: string; targetId: string; key: string }[] {
  const cancelled = cancelledIds(events);
  return events
    .filter((e) => e.kind === 'auto_writeoff' && !cancelled.has(e.id))
    .filter((e) => {
      const d = localDateOf(e.occurredAt, timeZone);
      return period.start <= d && d <= period.end;
    })
    .sort((a, b) => a.seq - b.seq)
    .map((e) => ({ productId: e.productId, targetId: e.id, key: absenceCancelKey(e.id) }));
}
