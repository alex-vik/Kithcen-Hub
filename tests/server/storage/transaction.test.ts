// T-004 / T-005 (ревью T-004): контракт storage.transaction — «всё или ничего», исходная ошибка не теряется.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, count, mkProduct, openFile, stock, T0 } from './helpers.ts';

afterEach(cleanup);

describe('T-004 transaction: контракт пакета', () => {
  it('успех: результат fn возвращается, записи на месте', () => {
    const { storage, raw } = openFile();
    const p = mkProduct('p-1', 'Гречка');
    storage.addProduct(p);
    const r = storage.transaction(() => {
      storage.addStockEvent(stock(p, 'e-1', 'portion', T0, { quantity: 1 }));
      return 42;
    });
    expect(r).toBe(42);
    expect(count(raw, 'stock_event')).toBe(1);
  });

  it('исключение внутри: записи откатываются, наружу уходит та же ошибка', () => {
    const { storage, raw } = openFile();
    const p = mkProduct('p-1', 'Гречка');
    storage.addProduct(p);
    const boom = new Error('boom');
    let caught: unknown;
    try {
      storage.transaction(() => {
        storage.addStockEvent(stock(p, 'e-1', 'portion', T0, { quantity: 1 }));
        throw boom;
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(boom);
    expect(count(raw, 'stock_event')).toBe(0);
  });

  it('вложенный вызов: исключение во внутреннем откатывает и внешние записи', () => {
    const { storage, raw } = openFile();
    const p = mkProduct('p-1', 'Гречка');
    storage.addProduct(p);
    const boom = new Error('inner');
    expect(() =>
      storage.transaction(() => {
        storage.addStockEvent(stock(p, 'e-1', 'portion', T0, { quantity: 1 }));
        storage.transaction(() => {
          storage.addStockEvent(stock(p, 'e-2', 'portion', T0, { quantity: 1 }));
          throw boom;
        });
      }),
    ).toThrow(boom);
    expect(count(raw, 'stock_event')).toBe(0);
  });

  it('после отката следующая транзакция работает (состояние вложенности сброшено)', () => {
    const { storage, raw } = openFile();
    const p = mkProduct('p-1', 'Гречка');
    storage.addProduct(p);
    expect(() => storage.transaction(() => { throw new Error('x'); })).toThrow('x');
    storage.transaction(() => storage.addStockEvent(stock(p, 'e-1', 'portion', T0, { quantity: 1 })));
    expect(count(raw, 'stock_event')).toBe(1);
    // и откат во второй транзакции по-прежнему работает
    expect(() =>
      storage.transaction(() => {
        storage.addStockEvent(stock(p, 'e-2', 'portion', T0, { quantity: 1 }));
        throw new Error('y');
      }),
    ).toThrow('y');
    expect(count(raw, 'stock_event')).toBe(1);
  });
});
