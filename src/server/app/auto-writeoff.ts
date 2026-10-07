// T-010, FR-CON-01, FR-CON-07, FR-CON-08, BR-27, Q-29, ADR-005: автосписание раз в сутки с догоном.
import { autoWriteoffsForDay } from '../../domain/auto-writeoff.ts';
import type { AutoWriteoffParams } from '../../domain/auto-writeoff.ts';
import { addDays, localDateOf, pendingDays } from '../../domain/time.ts';
import type { LocalDate } from '../../domain/time.ts';
import type { Clock } from '../clock.ts';
import type { Storage } from '../storage/index.ts';
import { createWriteScenarios } from './write.ts';

const JOB = 'auto_writeoff';

export function createAutoWriteoff(deps: { storage: Storage; clock: Clock; params: AutoWriteoffParams }) {
  const { storage, clock, params } = deps;
  const write = createWriteScenarios({ storage, clock });

  return {
    /** Каждые необработанные сутки — одна транзакция. Ошибка суток пробрасывается; прежние сутки остаются зафиксированными. */
    runPending(): { processed: LocalDate[] } {
      const now = clock.now();
      let cursor = storage.lastJobDay(JOB);
      if (cursor === undefined) {
        // Q-29: первый запуск ничего не досписывает
        cursor = addDays(localDateOf(now, params.timeZone), -1);
        storage.markJobDay(JOB, cursor);
      }
      const processed: LocalDate[] = [];
      for (const day of pendingDays(cursor, now, params)) {
        storage.transaction(() => {
          const entries = storage.listProducts().map((product) => ({ product, stateEvents: storage.listStateEvents(product.id) }));
          const items = autoWriteoffsForDay(day, entries, params).map((a) => ({
            productId: a.productId, kind: 'auto_writeoff' as const, source: 'auto_writeoff', quantity: a.quantity,
            key: a.key, occurredAt: a.occurredAt,
          }));
          const r = write.recordSystemBatch(items);
          // отказ вложенного пакета не откатывает уже вставленное — откат даёт только исключение (SAVEPOINT нет)
          if (r.outcome === 'rejected') throw new Error(`автосписание за ${day}: отказ ${r.attribute} (позиция ${r.index})`);
          storage.markJobDay(JOB, day);
        });
        processed.push(day);
      }
      return { processed };
    },
  };
}
