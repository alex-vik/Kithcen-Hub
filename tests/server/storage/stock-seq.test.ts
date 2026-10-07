// T-009 С1–С3: узкие методы чтения хранилища для кэша остатков (ADR-003a §4.1.4, §4.1.5, §5; НВ-7 а — имена §5 контракт).
//   maxStockSeq(): number                                  // MAX(seq) журнала остатка, 0 при пустом
//   productsChangedBetween(afterSeq, uptoSeq): string[]    // различные product_id с afterSeq < seq <= uptoSeq, порядок не задан
//   inTransaction(): boolean                               // true только пока выполняется fn внешней или вложенной transaction
import { afterEach, describe, expect, it } from 'vitest';
import { at, cleanup, mkProduct, openFile, state, stock, T0 } from './helpers.ts';
import type { StorageApi } from './helpers.ts';

afterEach(cleanup);

type Narrow = StorageApi & {
  maxStockSeq(): number;
  productsChangedBetween(afterSeq: number, uptoSeq: number): string[];
  inTransaction(): boolean;
};

function setup() {
  const f = openFile();
  const s = f.storage as Narrow;
  const [a, b, c] = [mkProduct('p-a', 'А'), mkProduct('p-b', 'Б'), mkProduct('p-c', 'В')];
  for (const p of [a, b, c]) s.addProduct(p);
  return { ...f, s, a, b, c };
}

describe('T-009 С1: maxStockSeq', () => {
  it('T-009 С1: пустой журнал — 0; после записи — seq последнего события, в том числе отмены; state_event не считается', () => {
    const { s, a, b } = setup();
    expect(s.maxStockSeq()).toBe(0);
    s.addStockEvent(stock(a, 'a1', 'purchase', at('10', '09:00'), { quantity: 100 }));
    expect(s.maxStockSeq()).toBe(1);
    s.addStockEvent(stock(b, 'b1', 'purchase', at('10', '10:00'), { quantity: 50 }));
    s.addStockEvent(stock(a, 'a2', 'cancel', at('10', '11:00'), { targetId: 'a1' }));
    expect(s.maxStockSeq()).toBe(3);
    s.addStateEvent(state('p-a', 's1', T0, 'inactive', 'user_button'));
    s.addStateEvent(state('p-a', 's2', at('12', '10:00'), 'active', 'user_restore'));
    expect(s.maxStockSeq()).toBe(3);
  });

  it('T-009 С1: повтор с тем же id (exists) и отказ (rejected) знак не меняют', () => {
    const { s, a, b } = setup();
    s.addStockEvent(stock(a, 'a1', 'purchase', at('10', '09:00'), { quantity: 100 }));
    s.addStockEvent(stock(b, 'b1', 'purchase', at('10', '10:00'), { quantity: 50 }));
    expect(s.addStockEvent(stock(a, 'a1', 'purchase', at('10', '09:00'), { quantity: 100 })).status).toBe('exists');
    expect(s.maxStockSeq()).toBe(2);
    const ghost = mkProduct('p-ghost', 'Нет в каталоге');
    expect(s.addStockEvent(stock(ghost, 'g1', 'purchase', at('10', '12:00'), { quantity: 1 })).status).toBe('rejected');
    expect(s.addStockEvent(stock(a, 'bad', 'cancel', at('10', '12:00'), { targetId: 'b1' })).status).toBe('rejected');
    expect(s.maxStockSeq()).toBe(2);
  });
});

describe('T-009 С2: productsChangedBetween', () => {
  // seq: 1 A, 2 B, 3 C, 4 A, 5 отмена b1 (позиция B), 6 C, 7 B
  function seeded() {
    const f = setup();
    const { s, a, b, c } = f;
    s.addStockEvent(stock(a, 'a1', 'purchase', at('10', '09:00'), { quantity: 100 }));
    s.addStockEvent(stock(b, 'b1', 'purchase', at('10', '09:10'), { quantity: 100 }));
    s.addStockEvent(stock(c, 'c1', 'purchase', at('10', '09:20'), { quantity: 100 }));
    s.addStockEvent(stock(a, 'a2', 'portion', at('10', '09:30'), { quantity: 10 }));
    s.addStockEvent(stock(b, 'b-cancel', 'cancel', at('10', '09:40'), { targetId: 'b1' }));
    s.addStockEvent(stock(c, 'c2', 'portion', at('10', '09:50'), { quantity: 10 }));
    s.addStockEvent(stock(b, 'b2', 'purchase', at('10', '10:00'), { quantity: 5 }));
    expect(s.maxStockSeq()).toBe(7);
    return s;
  }
  const sorted = (xs: string[]): string[] => [...xs].sort();

  it('T-009 С2: различные позиции диапазона, каждая один раз; afterSeq исключён, uptoSeq включён', () => {
    const s = seeded();
    expect(sorted(s.productsChangedBetween(0, 7))).toStrictEqual(['p-a', 'p-b', 'p-c']);
    expect(sorted(s.productsChangedBetween(0, 1))).toStrictEqual(['p-a']);
    expect(sorted(s.productsChangedBetween(1, 2))).toStrictEqual(['p-b']);
    expect(sorted(s.productsChangedBetween(1, 3))).toStrictEqual(['p-b', 'p-c']);
    expect(sorted(s.productsChangedBetween(2, 4))).toStrictEqual(['p-a', 'p-c']);
    expect(sorted(s.productsChangedBetween(3, 6))).toStrictEqual(['p-a', 'p-b', 'p-c']);
    // seq 4..7 содержат A, B (дважды), C: B один раз
    expect(s.productsChangedBetween(3, 7)).toHaveLength(3);
  });

  it('T-009 С2: отмена относится к позиции цели (B)', () => {
    const s = seeded();
    expect(s.productsChangedBetween(4, 5)).toStrictEqual(['p-b']);
  });

  it('T-009 С2: пустой диапазон (afterSeq ≥ uptoSeq) и диапазон без событий — пустой список', () => {
    const s = seeded();
    expect(s.productsChangedBetween(5, 5)).toStrictEqual([]);
    expect(s.productsChangedBetween(6, 3)).toStrictEqual([]);
    expect(s.productsChangedBetween(0, 0)).toStrictEqual([]);
    expect(s.productsChangedBetween(7, 100)).toStrictEqual([]);
    expect(s.productsChangedBetween(50, 100)).toStrictEqual([]);
  });
});

describe('T-009 С3: inTransaction', () => {
  it('T-009 С3: false вне транзакции; true внутри внешней и вложенной; false после фиксации', () => {
    const { s } = setup();
    expect(s.inTransaction()).toBe(false);
    const seen: boolean[] = [];
    s.transaction(() => {
      seen.push(s.inTransaction());
      s.transaction(() => {
        seen.push(s.inTransaction());
      });
      seen.push(s.inTransaction());
    });
    expect(seen).toStrictEqual([true, true, true]);
    expect(s.inTransaction()).toBe(false);
  });

  it('T-009 С3: false после отката исключением (внешней и вложенной) и после addStockEvent вне явной транзакции', () => {
    const { s, a } = setup();
    expect(() => s.transaction(() => { throw new Error('откат'); })).toThrow('откат');
    expect(s.inTransaction()).toBe(false);
    expect(() => s.transaction(() => { s.transaction(() => { throw new Error('вложенная'); }); })).toThrow('вложенная');
    expect(s.inTransaction()).toBe(false);
    s.addStockEvent(stock(a, 'a1', 'purchase', at('10', '09:00'), { quantity: 100 }));
    expect(s.inTransaction()).toBe(false);
    // и внутри fn запись одним вызовом не сбрасывает признак внешней транзакции
    let inside = false;
    s.transaction(() => {
      s.addStockEvent(stock(a, 'a2', 'portion', at('10', '10:00'), { quantity: 1 }));
      inside = s.inTransaction();
    });
    expect(inside).toBe(true);
    expect(s.inTransaction()).toBe(false);
  });
});
