// T-011 С7–С8: recordSystemBatch внутри внешней транзакции (зонд ревью T-010), BR-02, BR-26, NFR-07.
import { afterEach, describe, expect, it } from 'vitest';
import type { StockEvent } from '../../../src/domain/journal.ts';
import { cleanup, count, mkProduct, openFile, stock, T0 } from '../storage/helpers.ts';
import type { StorageApi, WriteResult } from '../storage/helpers.ts';
import { fakeClock, makeScenarios } from './helpers.ts';
import type { BatchOutcome, SystemItem } from './helpers.ts';

afterEach(cleanup);

const DAY = '2026-10-05T21:00:00.000Z';
const item = (productId: string): SystemItem => ({
  key: `auto_writeoff:${productId}:2026-10-06`, productId, kind: 'auto_writeoff', quantity: 5, occurredAt: DAY, source: 'system',
});

function setup() {
  const f = openFile();
  const p1 = mkProduct('p1', 'Один');
  const p2 = mkProduct('p2', 'Два');
  f.storage.addProduct(p1);
  f.storage.addProduct(p2);
  return { ...f, p1, p2, clock: fakeClock(DAY) };
}

type Variant = { name: string; second: string; wrap: (s: StorageApi) => StorageApi };
const variants: Variant[] = [
  { name: 'а: неизвестная productId', second: 'ghost', wrap: (s) => s },
  {
    name: 'б: addStockEvent второго элемента возвращает rejected',
    second: 'p2',
    wrap: (s) => ({
      ...s,
      addStockEvent: (e: StockEvent): WriteResult<StockEvent> =>
        e.productId === 'p2' && e.kind === 'auto_writeoff' ? { status: 'rejected', reason: 'unknown_product' } : s.addStockEvent(e),
    }),
  },
];

describe('T-011 С7: отказ пакета внутри внешней транзакции не оставляет вставок', () => {
  for (const v of variants) {
    it(`T-011 С7 (${v.name})`, () => {
      const { storage, raw, p2, clock } = setup();
      const items = [item('p1'), item(v.second)];
      const app = makeScenarios(v.wrap(storage), clock);
      let inner: BatchOutcome | undefined;
      storage.transaction(() => {
        inner = app.recordSystemBatch(items);
        storage.addStockEvent(stock(p2, 'e-x', 'portion', T0, { quantity: 1 }));
      });
      // эталон: тот же отказ вне транзакции
      const ref = setup();
      const outside = makeScenarios(v.wrap(ref.storage), ref.clock).recordSystemBatch(items);
      expect(outside.outcome).toBe('rejected');
      expect(inner).toEqual(outside);
      expect(inner).toMatchObject({ outcome: 'rejected', index: 1 });
      expect(storage.listStockEvents('p1')).toEqual([]);
      expect(storage.getStockEvent('e-x')).toBeDefined();
      expect(count(raw, 'stock_event')).toBe(1);
    });
  }
});

describe('T-011 С8: повтор пакета после перехваченного отказа — new, а не done (BR-26)', () => {
  it('T-011 С8: после С7(а) тот же ключ вне транзакции даёт new, у p1 одно auto_writeoff', () => {
    const { storage, p2, clock } = setup();
    const app = makeScenarios(storage, clock);
    storage.transaction(() => {
      app.recordSystemBatch([item('p1'), item('ghost')]);
      storage.addStockEvent(stock(p2, 'e-x', 'portion', T0, { quantity: 1 }));
    });
    const r = app.recordSystemBatch([item('p1')]);
    expect(r.outcome).toBe('ok');
    if (r.outcome === 'ok') expect(r.items.map((i) => i.outcome)).toEqual(['new']);
    expect(storage.listStockEvents('p1').filter((e) => e.kind === 'auto_writeoff')).toHaveLength(1);
  });
});
