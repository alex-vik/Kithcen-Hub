// T-012, FR-ABS-01…04, BR-02, BR-26, ADR-003 §5.3, §8, ADR-005 «Отпуск задним числом».
import { absenceCancels, createAbsencePeriod } from '../../domain/absence.ts';
import type { AbsencePeriod } from '../../domain/absence.ts';
import type { TimeZone } from '../../domain/time.ts';
import type { Clock } from '../clock.ts';
import type { Storage } from '../storage/index.ts';
import { createWriteScenarios } from './write.ts';

export type AbsenceOutcome =
  | { outcome: 'new' | 'repeat'; period: AbsencePeriod; cancelled: number }
  | { outcome: 'conflict'; period: AbsencePeriod }
  | { outcome: 'rejected'; attribute: string };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createAbsence(deps: { storage: Storage; clock: Clock; params: { timeZone: TimeZone } }) {
  const { storage, clock, params } = deps;
  const write = createWriteScenarios({ storage, clock });

  return {
    /** Период и все отмены — одна транзакция; отказ пакета бросает исключение и откатывает всё. Ошибки хранилища не перехватываются. */
    recordAbsence(input: { id: unknown; start: unknown; end: unknown }): AbsenceOutcome {
      if (typeof input.id !== 'string' || !UUID_V4.test(input.id)) return { outcome: 'rejected', attribute: 'id' };
      const now = clock.now();
      const p = createAbsencePeriod({ id: input.id, start: input.start, end: input.end, recordedAt: now });
      if (!p.ok) return { outcome: 'rejected', attribute: p.error.attribute };
      const period = p.value;
      return storage.transaction((): AbsenceOutcome => {
        const w = storage.addAbsencePeriod(period);
        if (w.status === 'exists') {
          const same = w.period.start === period.start && w.period.end === period.end;
          return same ? { outcome: 'repeat', period: w.period, cancelled: 0 } : { outcome: 'conflict', period: w.period };
        }
        const events = storage.listProducts().flatMap((x) => storage.listStockEvents(x.id));
        const items = absenceCancels(w.period, events, params.timeZone).map((c) => ({
          productId: c.productId, kind: 'cancel' as const, source: 'absence', targetId: c.targetId, key: c.key, occurredAt: now,
        }));
        const r = write.recordSystemBatch(items);
        // как runPending (T-010 А11): throw откатывает период и все отмены; наружу уходит исключение (О11)
        if (r.outcome === 'rejected') throw new Error(`отпуск ${period.id}: отказ ${r.attribute} (отмена ${r.index})`);
        return { outcome: 'new', period: w.period, cancelled: r.items.filter((i) => i.outcome === 'new').length };
      });
    },
  };
}
