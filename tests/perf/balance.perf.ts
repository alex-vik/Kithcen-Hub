// T-008 К16-К18 на полном журнале (npm run perf; в npm test не входит). ADR-003 §3, Q-02.
import { describe, expect, it } from 'vitest';
import { openStorage } from '../../src/server/storage/index.ts';
import { checkDeterminism, checkDomainEqualsStorage, checkJournalShape, withTempDb } from './checks.ts';
import { PERF } from './config.ts';
import {
  balancesInMemory, balancesViaStorage, generateJournal, groupByProduct, loadIntoStorage, median, percentile,
} from './journal.ts';

const ms = (x: number): string => x.toFixed(1);
const stats = (xs: number[]): string =>
  `медиана ${ms(median(xs))} мс, p90 ${ms(percentile(xs, 0.9))} мс, min ${ms(Math.min(...xs))} мс, max ${ms(Math.max(...xs))} мс`;

function measure(fn: () => unknown): number[] {
  for (let i = 0; i < PERF.warmup; i++) fn();
  const out: number[] = [];
  for (let i = 0; i < PERF.repeats; i++) {
    const t0 = performance.now();
    fn();
    out.push(performance.now() - t0);
  }
  return out;
}

describe('T-008 полный журнал', () => {
  const g0 = performance.now();
  const journal = generateJournal(PERF.seed, PERF.fullEvents);
  const genMs = performance.now() - g0;

  it('T-008 К16: полный журнал 500 тыс. событий, 200 позиций, 60 ритмичных, ≤5000 на позицию, все виды', () => {
    checkJournalShape(journal, PERF.fullEvents);
  });

  it('T-008 К16: тот же сид даёт тот же журнал, другой — иной (на полном объёме)', () => {
    checkDeterminism(PERF.fullEvents);
  });

  it('T-008 К17: остатки всех позиций в памяти и через хранилище совпадают (полный объём)', () => {
    checkDomainEqualsStorage(journal);
  });

  it('T-008 К18: медиана расчёта всех остатков через хранилище ≤ 100 мс (ADR-003 §3)', () => {
    withTempDb((path) => {
      const writer = openStorage({ path, busyTimeoutMs: 5000 });
      const l0 = performance.now();
      loadIntoStorage(writer, journal);
      const loadMs = performance.now() - l0;
      writer.close();

      // БД открыта заново (К18).
      const storage = openStorage({ path, busyTimeoutMs: 5000 });
      try {
        const grouped = groupByProduct(journal.events);
        const mem = measure(() => balancesInMemory(grouped));
        const sto = measure(() => balancesViaStorage(storage));
        const lines = [
          `[T-008 К18] Node ${process.version}; событий ${journal.events.length}, позиций ${journal.products.length}`,
          `[T-008 К18] генерация ${ms(genMs)} мс, вставка в хранилище ${ms(loadMs)} мс`,
          `[T-008 К18] (а) память:    ${stats(mem)}`,
          `[T-008 К18] (б) хранилище: ${stats(sto)}`,
          '[T-008 К18] замер в среде разработки, не на целевом сервере (Q-02)',
        ];
        console.log(lines.join('\n'));
        expect(
          median(sto),
          `сработало условие ADR-003 §3: нужен кэш (медиана ${ms(median(sto))} мс > ${PERF.thresholdMs} мс)`,
        ).toBeLessThanOrEqual(PERF.thresholdMs);
      } finally {
        storage.close();
      }
    });
  });
});
