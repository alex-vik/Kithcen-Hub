// T-003: хранение журнала остатка на :memory: (ADR-002, ADR-003).
// Новые К6–К9; переведены T-002 К16, К17, К19, К21, К22.
import { beforeEach, describe, expect, test } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { defaultParams, foldStock } from '../../src/domain/index.ts';
import {
  createProduct, getProduct, getStock, getStockEvents, recordStockEvent,
} from '../../src/server/db/index.ts';
import { T_CREATE, milk } from '../helpers/products.ts';
import { milkEvents, usedBefore } from '../helpers/stock.ts';
import { changesOf, count, newDb, rows } from '../helpers/db.ts';

const NOW = Temporal.Instant.from('2026-10-06T10:00:00Z');
const at = (s: string) => Temporal.Instant.from(s);
const ms = (s: string) => at(s).epochMilliseconds;

let db: DatabaseSync;
beforeEach(() => {
  db = newDb();
});

function mk(input: Record<string, unknown> = milk) {
  const r = createProduct(db, input, T_CREATE, defaultParams);
  if (!r.ok) throw new Error('создание отклонено: ' + JSON.stringify(r.errors));
  return r.product;
}
let n = 0;
// Запись, которая должна удаться; id событий задаёт тест (ADR-004), здесь — счётчик.
function rec(productId: string, input: Record<string, unknown>, now = NOW) {
  const r = recordStockEvent(db, { id: `ev-${++n}`, productId, ...input }, now);
  if (!r.ok) throw new Error('событие отклонено: ' + JSON.stringify(r.errors));
  return r.event;
}
const balanceOf = (id: string) => getStock(db, id)?.balance;

describe('T-003 К6: «использовал» по умолчанию снимает 1 (5.2, Р-3)', () => {
  test('T-003 К6: хранятся 1 и 2, остаток 3', () => {
    const p = mk();
    rec(p.id, { type: 'purchase', qty: 6 });
    rec(p.id, { type: 'used' });
    rec(p.id, { type: 'used', qty: 2 });
    const used = getStockEvents(db, p.id).filter((e) => e.type === 'used');
    expect(used.map((e) => e.qty)).toEqual([1, 2]);
    expect(balanceOf(p.id)).toBe(3);
  });
});

describe('T-003 К7: «закончилось» обнуляет, минус не блокируется (BR-15, инвариант 6)', () => {
  test('T-003 К7: остатки после событий −1, 0, 4; у «закончилось» количество пустое', () => {
    const p = mk();
    rec(p.id, { type: 'purchase', qty: 1 }, at('2026-10-06T09:00:00Z'));
    rec(p.id, { type: 'used', qty: 2 }, at('2026-10-06T10:00:00Z'));
    rec(p.id, { type: 'ran_out' }, at('2026-10-06T11:00:00Z'));
    rec(p.id, { type: 'purchase', qty: 4 }, at('2026-10-06T12:00:00Z'));
    const stock = getStock(db, p.id)!;
    expect(stock.steps.map((s) => s.after)).toEqual([1, -1, 0, 4]);
    expect(stock.balance).toBe(4);
    const ev = getStockEvents(db, p.id);
    expect(ev).toHaveLength(4);
    expect(ev[2]!.qty).toBeNull();
  });
});

describe('T-003 К8: каждый тип пишется и читается', () => {
  const NOW8 = at('2026-10-08T12:00:00Z');
  const OCC = at('2026-10-08T09:00:00Z');
  const qtyOf: Record<string, number | null> = { purchase: 6, used: 2, ran_out: null, recount: 3 };
  test.each(Object.keys(qtyOf))('T-003 К8: %s', (type) => {
    const p = mk();
    const qty = qtyOf[type]!;
    const input: Record<string, unknown> = { id: `t-${type}`, productId: p.id, type, occurredAt: OCC };
    if (qty !== null) input.qty = qty;
    expect(recordStockEvent(db, input, NOW8).ok).toBe(true);
    expect(getStockEvents(db, p.id)).toEqual([
      expect.objectContaining({
        id: `t-${type}`, productId: p.id, type, qty,
        occurredAt: OCC.epochMilliseconds, recordedAt: NOW8.epochMilliseconds,
      }),
    ]);
  });
});

describe('T-003 К9: недопустимый ввод события отклоняется без записи', () => {
  const bad: [string, Record<string, unknown>, string][] = [
    ['тип «portion»', { type: 'portion', qty: 1 }, 'type'],
    ['тип «auto_writeoff»', { type: 'auto_writeoff', qty: 1 }, 'type'],
    ['тип «inventory»', { type: 'inventory', qty: 1 }, 'type'],
    ['тип «cancel»', { type: 'cancel' }, 'type'],
    ['покупка без количества', { type: 'purchase' }, 'qty'],
    ['покупка 0', { type: 'purchase', qty: 0 }, 'qty'],
    ['покупка −1', { type: 'purchase', qty: -1 }, 'qty'],
    ['«использовал» 0', { type: 'used', qty: 0 }, 'qty'],
    ['«использовал» −1', { type: 'used', qty: -1 }, 'qty'],
    ['«пересчитал» без значения', { type: 'recount' }, 'qty'],
    ['«пересчитал» −1', { type: 'recount', qty: -1 }, 'qty'],
  ];
  test.each(bad)('T-003 К9: %s', (_n, input, field) => {
    const p = mk();
    const r = recordStockEvent(db, { id: 'bad-1', productId: p.id, ...input }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toContain(field);
    expect(count(db, 'stock_events')).toBe(0);
  });

  test('T-003 К9: позиция не существует — ошибка productId', () => {
    const r = recordStockEvent(db, { id: 'bad-2', productId: 'no-such', type: 'used', qty: 1 }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toContain('productId');
    expect(count(db, 'stock_events')).toBe(0);
  });

  test('T-003 К9: «пересчитал» 0 и дробные количества принимаются', () => {
    const p = mk();
    rec(p.id, { type: 'recount', qty: 0 }, at('2026-10-06T08:00:00Z'));
    rec(p.id, { type: 'purchase', qty: 0.5 }, at('2026-10-06T09:00:00Z'));
    rec(p.id, { type: 'recount', qty: 1.5 }, at('2026-10-06T10:00:00Z'));
    expect(count(db, 'stock_events')).toBe(3);
    expect(balanceOf(p.id)).toBe(1.5);
  });
});

describe('T-002 К16 (T-003): seq и время события', () => {
  test('T-003 К8: seq растёт, occurred_at по умолчанию = часы, recorded_at = часы (по П-1)', () => {
    const now = at('2026-10-08T12:00:00Z');
    const p = mk();
    rec(p.id, { type: 'used', qty: 1 }, now);
    rec(p.id, { type: 'used', qty: 1, occurredAt: at('2026-10-08T15:00:00Z') }, now);
    rec(p.id, { type: 'used', qty: 1, occurredAt: at('2026-10-05T08:00:00Z') }, now);
    const ev = getStockEvents(db, p.id);
    expect(ev).toHaveLength(3);
    expect(ev[0]!.seq).toBeLessThan(ev[1]!.seq);
    expect(ev[1]!.seq).toBeLessThan(ev[2]!.seq);
    expect(ev.map((e) => e.occurredAt)).toEqual([ms('2026-10-08T12:00:00Z'), ms('2026-10-08T12:00:00Z'), ms('2026-10-05T08:00:00Z')]);
    expect(ev.map((e) => e.recordedAt)).toEqual([now.epochMilliseconds, now.epochMilliseconds, now.epochMilliseconds]);
  });
});

describe('T-002 К17 (T-003): журнал неизменяем (инвариант 2)', () => {
  test('T-003 К8: UPDATE отклоняется', () => {
    const p = mk();
    rec(p.id, { type: 'purchase', qty: 6 });
    const snap = rows(db, 'SELECT * FROM stock_events');
    expect(() => db.exec('UPDATE stock_events SET qty = 1')).toThrow();
    expect(rows(db, 'SELECT * FROM stock_events')).toEqual(snap);
  });
  test('T-003 К8: DELETE отклоняется', () => {
    const p = mk();
    rec(p.id, { type: 'purchase', qty: 6 });
    const snap = rows(db, 'SELECT * FROM stock_events');
    expect(() => db.exec('DELETE FROM stock_events')).toThrow();
    expect(rows(db, 'SELECT * FROM stock_events')).toEqual(snap);
  });
});

describe('T-002 К19 (T-003): остаток из хранения = свёртка журнала (NFR-08, инвариант 1)', () => {
  test('T-003 К5: молоко — остаток 2, шаги = свёртка над stock_events, id есть в таблице', () => {
    const p = mk();
    const now = at('2026-10-07T12:00:00Z');
    const specs = [...milkEvents(), usedBefore()]; // последняя записана позже, но случилась раньше
    for (const e of specs) {
      rec(p.id, { type: e.type, qty: e.qty ?? undefined, occurredAt: at(new Date(e.occurredAt).toISOString().replace('.000Z', 'Z')) }, now);
    }
    const stock = getStock(db, p.id);
    expect(stock?.balance).toBe(2);
    expect(stock).toEqual(foldStock(getStockEvents(db, p.id)));
    const ids = new Set(rows(db, 'SELECT id FROM stock_events').map((r) => r.id));
    for (const s of stock!.steps) expect(ids.has(s.eventId)).toBe(true);
    expect(stock!.steps).toHaveLength(5);
  });
  test('T-003 К5: позиция без событий — 0; несуществующая — null, не 0', () => {
    const p = mk();
    expect(getStock(db, p.id)).toEqual({ balance: 0, steps: [] });
    expect(getStock(db, 'no-such-product')).toBeNull();
  });
});

describe('T-002 К22 (T-003): неактивная позиция принимает события', () => {
  test('T-003 К8: остаток 6, активность и product_changes не тронуты', () => {
    const p = mk();
    db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(p.id);
    rec(p.id, { type: 'purchase', qty: 6 });
    expect(balanceOf(p.id)).toBe(6);
    expect(getProduct(db, p.id)?.active).toBe(false);
    expect(changesOf(db, p.id)).toHaveLength(1);
  });
});
