// T-004 / T-005 (ревью T-004): контракт storage.transaction — «всё или ничего», исходная ошибка не теряется.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, count, mkProduct, openFile, state, stock, T0 } from './helpers.ts';
import type { JobStorage } from '../app/auto-helpers.ts';

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

// T-011: вложенный вызов атомарен сам по себе (SAVEPOINT). С9 — существующие тесты выше без изменений.
describe('T-011 вложенная transaction: SAVEPOINT', () => {
  const setup = () => {
    const f = openFile();
    const storage = f.storage as JobStorage;
    const p = mkProduct('p-1', 'Гречка');
    storage.addProduct(p);
    const put = (id: string) => storage.addStockEvent(stock(p, id, 'portion', T0, { quantity: 1 }));
    const ids = () =>
      (f.raw.prepare('SELECT id FROM stock_event ORDER BY seq').all() as { id: string }[]).map((r) => r.id);
    return { ...f, storage, p, put, ids };
  };

  it('T-011 С1: перехваченное исключение вложенного вызова откатывает только его записи', () => {
    const { storage, raw, p, put, ids } = setup();
    const boom = new Error('boom');
    let caught: unknown;
    const r = storage.transaction(() => {
      put('e-1');
      try {
        storage.transaction(() => {
          put('e-2');
          storage.addStateEvent(state(p.id, 's-1', T0, 'inactive', 'user_button'));
          storage.markJobDay('auto_writeoff', '2026-10-06');
          throw boom;
        });
      } catch (e) {
        caught = e;
      }
      put('e-3');
      return 42;
    });
    expect(r).toBe(42);
    expect(caught).toBe(boom);
    expect(ids()).toEqual(['e-1', 'e-3']);
    expect(count(raw, 'state_event')).toBe(0);
    expect(storage.lastJobDay('auto_writeoff')).toBeUndefined();
  });

  it('T-011 С2: успешный вложенный вызов фиксируется вместе с внешним', () => {
    const { storage, put, ids } = setup();
    storage.transaction(() => {
      const x = storage.transaction(() => {
        put('e-1');
        return 'x';
      });
      expect(x).toBe('x');
      put('e-2');
    });
    expect(ids()).toEqual(['e-1', 'e-2']);
  });

  it('T-011 С3: исключение внешнего fn после успешного вложенного вызова откатывает всё', () => {
    const { storage, put, ids } = setup();
    const boom = new Error('outer');
    expect(() =>
      storage.transaction(() => {
        storage.transaction(() => put('e-1'));
        put('e-2');
        throw boom;
      }),
    ).toThrow(boom);
    expect(ids()).toEqual([]);
  });

  it('T-011 С4: три уровня — средний перехватывает сбой внутреннего', () => {
    const { storage, put, ids } = setup();
    storage.transaction(() => {
      put('e-1');
      storage.transaction(() => {
        put('e-2');
        try {
          storage.transaction(() => {
            put('e-3');
            throw new Error('inner');
          });
        } catch {
          /* перехвачено */
        }
        put('e-4');
      });
    });
    expect(ids()).toEqual(['e-1', 'e-2', 'e-4']);
  });

  function scenarioC5(f: ReturnType<typeof setup>): void {
    const { storage, put } = f;
    const attempt = (id: string, fail: boolean) => {
      try {
        storage.transaction(() => {
          put(id);
          if (fail) throw new Error(`fail ${id}`);
        });
      } catch {
        /* перехвачено */
      }
      expect(storage.inTransaction()).toBe(true);
    };
    storage.transaction(() => {
      attempt('e-1', true);
      attempt('e-2', false);
      attempt('e-3', true);
    });
    expect(storage.inTransaction()).toBe(false);
  }

  it('T-011 С5: следующий вложенный вызов после перехваченного сбоя работает и откатывается сам по себе', () => {
    const f = setup();
    scenarioC5(f);
    expect(f.ids()).toEqual(['e-2']);
  });

  it('T-011 С6: после внешнего вызова с вложенными сбоями следующий внешний — полноценная транзакция', () => {
    const f = setup();
    scenarioC5(f);
    expect(() =>
      f.storage.transaction(() => {
        f.put('e-5');
        throw new Error('y');
      }),
    ).toThrow('y');
    expect(f.ids()).toEqual(['e-2']);
  });

  it('T-011 С9 (охрана): внешний вызов по-прежнему BEGIN IMMEDIATE — писатель с другого соединения сразу получает отказ', () => {
    const { storage, raw } = setup();
    raw.exec('PRAGMA busy_timeout = 0');
    storage.transaction(() => {
      expect(() => raw.exec('BEGIN IMMEDIATE')).toThrow(/locked|busy/i);
    });
    raw.exec('BEGIN IMMEDIATE');
    raw.exec('ROLLBACK');
  });
});
