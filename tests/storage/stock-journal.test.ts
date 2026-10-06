// T-002: хранение журнала остатка на :memory: (ADR-002, ADR-003). К10–К22, К23 (хранение), К24, К25.
import { beforeEach, describe, expect, test } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { defaultParams, foldStock, stockEventTypes } from '../../src/domain/index.ts';
import {
  createProduct, getProduct, getStock, getStockEvents, recordStockEvent, updateProduct,
} from '../../src/server/db/index.ts';
import { T_CREATE, T_EDIT, coffee } from '../helpers/products.ts';
import { adrCoffee } from '../helpers/stock.ts';
import { changesOf, count, newDb, rows } from '../helpers/db.ts';

const NOW = Temporal.Instant.from('2026-10-06T10:00:00Z');
const ms = (s: string) => Temporal.Instant.from(s).epochMilliseconds;

let db: DatabaseSync;
beforeEach(() => {
  db = newDb();
});

function mk(input: Record<string, unknown> = coffee) {
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

describe('T-002 К10: приход в упаковках', () => {
  test('T-002 К10: 2 упаковки → 500 г, упаковки 2, коэффициент 250, остаток 500', () => {
    const p = mk();
    rec(p.id, { type: 'purchase', packages: 2 });
    const [e] = getStockEvents(db, p.id);
    expect(e).toMatchObject({ type: 'purchase', qty: 500, packages: 2, packageFactor: 250 });
    expect(balanceOf(p.id)).toBe(500);
  });
});

describe('T-002 К11: смена коэффициента не меняет старые события', () => {
  test('T-002 К11: после коэффициента 1000 — 500/2/250 и 1000/1/1000, остаток 1500', () => {
    const p = mk();
    rec(p.id, { type: 'purchase', packages: 2 });
    const u = updateProduct(db, p.id, { packageFactor: 1000 }, T_EDIT, defaultParams);
    expect(u.ok).toBe(true);
    rec(p.id, { type: 'purchase', packages: 1 });
    const [a, b] = getStockEvents(db, p.id);
    expect(a).toMatchObject({ qty: 500, packages: 2, packageFactor: 250 });
    expect(b).toMatchObject({ qty: 1000, packages: 1, packageFactor: 1000 });
    expect(balanceOf(p.id)).toBe(1500);
  });
});

describe('T-002 К12: приход сразу в расходных единицах', () => {
  test('T-002 К12: 300 г, упаковки и коэффициент пусты, остаток 300', () => {
    const p = mk({ name: 'Сыр', consumptionUnit: 'г' });
    rec(p.id, { type: 'purchase', qty: 300 });
    const [e] = getStockEvents(db, p.id);
    expect(e).toMatchObject({ qty: 300, packages: null, packageFactor: null });
    expect(balanceOf(p.id)).toBe(300);
  });
});

describe('T-002 К13: разный размер упаковки — одна позиция (BR-04)', () => {
  test('T-002 К13: 500 и 1000, коэффициент позиции прежний, product_changes не растёт', () => {
    const p = mk({ name: 'Молоко', consumptionUnit: 'мл', packageName: 'бутылка', packageFactor: 1000 });
    rec(p.id, { type: 'purchase', packages: 1, packageFactor: 500 });
    rec(p.id, { type: 'purchase', packages: 1 });
    const [a, b] = getStockEvents(db, p.id);
    expect(a).toMatchObject({ qty: 500, packageFactor: 500 });
    expect(b).toMatchObject({ qty: 1000, packageFactor: 1000 });
    expect(balanceOf(p.id)).toBe(1500);
    expect(getProduct(db, p.id)?.packageFactor).toBe(1000);
    expect(changesOf(db, p.id)).toHaveLength(1);
  });
});

describe('T-002 К14: приход в упаковках без коэффициента [Q-28, по умолчанию]', () => {
  test('T-002 К14: ошибка packageFactor, ничего не записано, остаток 0', () => {
    const p = mk({ name: 'Гречка', consumptionUnit: 'г' });
    const r = recordStockEvent(db, { id: 'g-1', productId: p.id, type: 'purchase', packages: 2 }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toContain('packageFactor');
    expect(count(db, 'stock_events')).toBe(0);
    expect(balanceOf(p.id)).toBe(0);
  });
  test('T-002 К14: с коэффициентом покупки 800 — 1600, коэффициент позиции пуст', () => {
    const p = mk({ name: 'Гречка', consumptionUnit: 'г' });
    rec(p.id, { type: 'purchase', packages: 2, packageFactor: 800 });
    expect(getStockEvents(db, p.id)[0]).toMatchObject({ qty: 1600, packages: 2, packageFactor: 800 });
    expect(getProduct(db, p.id)?.packageFactor).toBeNull();
  });
});

describe('T-002 К15: каждый тип события записывается и читается', () => {
  const NOW15 = Temporal.Instant.from('2026-10-08T12:00:00Z');
  const OCC = Temporal.Instant.from('2026-10-08T09:00:00Z');
  const qtyOf: Record<string, number | null> = {
    purchase: 500, portion: 10, auto_writeoff: 20, recipe_writeoff: 30, spoilage: 40, ran_out: null, inventory: 450,
  };
  test('T-002 К15: перечень типов — ровно 7 из 5.2 (без отмены)', () => {
    expect([...stockEventTypes].sort()).toEqual(Object.keys(qtyOf).sort());
  });
  test.each(Object.keys(qtyOf))('T-002 К15: %s', (type) => {
    const p = mk();
    const qty = qtyOf[type]!;
    const input: Record<string, unknown> = { id: `t-${type}`, productId: p.id, type, occurredAt: OCC };
    if (qty !== null) input.qty = qty;
    const r = recordStockEvent(db, input, NOW15);
    expect(r.ok).toBe(true);
    expect(getStockEvents(db, p.id)).toEqual([
      expect.objectContaining({
        id: `t-${type}`, productId: p.id, type, qty,
        occurredAt: OCC.epochMilliseconds, recordedAt: NOW15.epochMilliseconds,
      }),
    ]);
  });
});

describe('T-002 К16: seq и время события', () => {
  test('T-002 К16: seq растёт, occurred_at по П-1, recorded_at = часы', () => {
    const now = Temporal.Instant.from('2026-10-08T12:00:00Z');
    const p = mk();
    rec(p.id, { type: 'portion', qty: 10 }, now);
    rec(p.id, { type: 'portion', qty: 10, occurredAt: Temporal.Instant.from('2026-10-08T15:00:00Z') }, now);
    rec(p.id, { type: 'portion', qty: 10, occurredAt: Temporal.Instant.from('2026-10-05T08:00:00Z') }, now);
    const ev = getStockEvents(db, p.id);
    expect(ev).toHaveLength(3);
    expect(ev[0]!.seq).toBeLessThan(ev[1]!.seq);
    expect(ev[1]!.seq).toBeLessThan(ev[2]!.seq);
    expect(ev.map((e) => e.occurredAt)).toEqual([ms('2026-10-08T12:00:00Z'), ms('2026-10-08T12:00:00Z'), ms('2026-10-05T08:00:00Z')]);
    expect(ev.map((e) => e.recordedAt)).toEqual([now.epochMilliseconds, now.epochMilliseconds, now.epochMilliseconds]);
  });
});

describe('T-002 К17: журнал неизменяем (инвариант 2)', () => {
  test('T-002 К17: UPDATE отклоняется', () => {
    const p = mk();
    rec(p.id, { type: 'purchase', qty: 500 });
    const snap = rows(db, 'SELECT * FROM stock_events');
    expect(() => db.exec('UPDATE stock_events SET qty = 1')).toThrow();
    expect(rows(db, 'SELECT * FROM stock_events')).toEqual(snap);
  });
  test('T-002 К17: DELETE отклоняется', () => {
    const p = mk();
    rec(p.id, { type: 'purchase', qty: 500 });
    const snap = rows(db, 'SELECT * FROM stock_events');
    expect(() => db.exec('DELETE FROM stock_events')).toThrow();
    expect(rows(db, 'SELECT * FROM stock_events')).toEqual(snap);
  });
});

describe('T-002 К18: остаток не хранится, мест и открытости нет', () => {
  const colsOf = (t: string) => rows(db, `SELECT name FROM pragma_table_info('${t}')`).map((r) => r.name as string).sort();
  test('T-002 К18: колонки products — как T-001 К8', () => {
    expect(colsOf('products')).toEqual(
      ['id', 'name', 'category', 'write_off_type', 'consumption_unit', 'package_name', 'package_factor',
        'norm', 'low_stock_threshold', 'portion', 'active', 'created_at'].sort(),
    );
  });
  test('T-002 К18: колонки stock_events — зафиксированный перечень', () => {
    expect(colsOf('stock_events')).toEqual(
      ['id', 'product_id', 'type', 'qty', 'packages', 'package_factor', 'occurred_at', 'recorded_at', 'seq'].sort(),
    );
  });
  test('T-002 К18: таблицы — только каталог и журналы; нет колонок остатка, места, открытости', () => {
    const tables = rows(db, `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .map((r) => r.name as string).sort();
    expect(tables).toEqual(['product_changes', 'products', 'stock_events']);
    const banned = /balance|remain|total|running|location|storage|place|shelf|fridge|open|остат|мест/i;
    for (const t of ['products', 'stock_events']) {
      expect(colsOf(t).filter((c) => banned.test(c))).toEqual([]);
    }
  });
});

describe('T-002 К19: остаток из хранения = свёртка журнала (NFR-08)', () => {
  test('T-002 К19: 430, шаги = доменная свёртка над stock_events, id есть в таблице, повтор тот же', () => {
    const p = mk();
    const now = Temporal.Instant.from('2026-10-07T12:00:00Z');
    const specs: [string, string, number][] = [];
    for (const e of adrCoffee()) specs.push([e.type, new Date(e.occurredAt).toISOString(), e.qty as number]);
    specs.push(['portion', '2026-10-04T08:00:00Z', 10]); // К5: записана последней, но случилась раньше
    for (const [type, at, qty] of specs) {
      rec(p.id, { type, qty, occurredAt: Temporal.Instant.from(at.replace('.000Z', 'Z')) }, now);
    }
    const stock = getStock(db, p.id);
    const stored = getStockEvents(db, p.id);
    expect(stock?.balance).toBe(430);
    expect(stock).toEqual(foldStock(stored));
    const ids = new Set(rows(db, 'SELECT id FROM stock_events').map((r) => r.id));
    for (const s of stock!.steps) expect(ids.has(s.eventId)).toBe(true);
    expect(stock!.steps).toHaveLength(5);
    expect(getStock(db, p.id)).toEqual(stock);
  });
  test('T-002 К19: позиция без событий — 0; несуществующая — пусто (null), не 0', () => {
    const p = mk();
    expect(getStock(db, p.id)).toEqual({ balance: 0, steps: [] });
    expect(getStock(db, 'no-such-product')).toBeNull();
  });
});

describe('T-002 К20: остатки позиций независимы (BR-05)', () => {
  test('T-002 К20: зёрна 500, капсулы −2, события раздельно', () => {
    const beans = mk({ ...coffee, name: 'Кофе в зёрнах' });
    const caps = mk({ name: 'Кофе в капсулах', consumptionUnit: 'шт', norm: 2, portion: 1 });
    rec(beans.id, { type: 'purchase', qty: 500 });
    rec(caps.id, { type: 'portion', qty: 2 });
    expect(balanceOf(beans.id)).toBe(500);
    expect(balanceOf(caps.id)).toBe(-2);
    expect(getStockEvents(db, beans.id).map((e) => e.type)).toEqual(['purchase']);
    expect(getStockEvents(db, caps.id).map((e) => e.type)).toEqual(['portion']);
  });
});

describe('T-002 К21: минус не блокируется при записи (инвариант 6)', () => {
  test('T-002 К21: 100 − 150 − 10 = −60', () => {
    const p = mk();
    rec(p.id, { type: 'purchase', qty: 100 });
    rec(p.id, { type: 'portion', qty: 150 });
    rec(p.id, { type: 'spoilage', qty: 10 });
    expect(getStockEvents(db, p.id)).toHaveLength(3);
    expect(balanceOf(p.id)).toBe(-60);
  });
});

describe('T-002 К22: неактивная позиция принимает события (П-2)', () => {
  test('T-002 К22: остаток 250, активность и product_changes не тронуты', () => {
    const p = mk();
    db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(p.id);
    rec(p.id, { type: 'purchase', packages: 1 });
    expect(balanceOf(p.id)).toBe(250);
    expect(getProduct(db, p.id)?.active).toBe(false);
    expect(changesOf(db, p.id)).toHaveLength(1);
  });
});

describe('T-002 К23 (хранение): недопустимый ввод отклоняется без записи', () => {
  const bad: [string, Record<string, unknown>, string[]][] = [
    ['тип «cancel»', { type: 'cancel' }, ['type']],
    ['неизвестный тип', { type: 'foo' }, ['type']],
    ['порция 0', { type: 'portion', qty: 0 }, ['qty']],
    ['порция без количества', { type: 'portion' }, ['qty']],
    ['инвентаризация −1', { type: 'inventory', qty: -1 }, ['qty']],
    ['покупка 0 упаковок', { type: 'purchase', packages: 0 }, ['packages']],
    ['покупка пустая', { type: 'purchase' }, ['qty', 'packages']],
  ];
  test.each(bad)('T-002 К23: %s', (_n, input, fields) => {
    const p = mk();
    const r = recordStockEvent(db, { id: 'bad-1', productId: p.id, ...input }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => fields.includes(e.field))).toBe(true);
    expect(count(db, 'stock_events')).toBe(0);
  });

  test('T-002 К23: позиция не существует (П-3) — ошибка productId, без записи', () => {
    const r = recordStockEvent(db, { id: 'bad-2', productId: 'no-such', type: 'portion', qty: 10 }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toContain('productId');
    expect(count(db, 'stock_events')).toBe(0);
  });

  test('T-002 К23: инвентаризация 0 и дробные значения принимаются', () => {
    const p = mk();
    rec(p.id, { type: 'inventory', qty: 0 });
    rec(p.id, { type: 'portion', qty: 12.5 });
    rec(p.id, { type: 'purchase', packages: 0.5 });
    rec(p.id, { type: 'purchase', packages: 1, packageFactor: 0.5 });
    expect(count(db, 'stock_events')).toBe(4);
    expect(balanceOf(p.id)).toBe(0 - 12.5 + 125 + 0.5);
  });
});

describe('T-002 К24: единицу нельзя сменить, пока есть события', () => {
  const unitBlocked = (patch: Record<string, unknown>) => {
    const p = mk();
    rec(p.id, { type: 'purchase', qty: 500 });
    const before = getProduct(db, p.id);
    const r = updateProduct(db, p.id, patch, T_EDIT, defaultParams);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toContain('consumptionUnit');
    expect(getProduct(db, p.id)).toEqual(before);
    expect(changesOf(db, p.id)).toHaveLength(1);
  };
  test('T-002 К24 (а): только единица', () => unitBlocked({ consumptionUnit: 'шт' }));
  test('T-002 К24 (б): единица и норма 25 в одной правке — норма тоже не применяется', () =>
    unitBlocked({ consumptionUnit: 'шт', norm: 25 }));
});

describe('T-002 К25: без событий единица меняется; остальное правится и с событиями', () => {
  test('T-002 К25 (а): без событий единица «шт», запись в product_changes', () => {
    const p = mk();
    const r = updateProduct(db, p.id, { consumptionUnit: 'шт' }, T_EDIT, defaultParams);
    expect(r.ok).toBe(true);
    expect(getProduct(db, p.id)?.consumptionUnit).toBe('шт');
    expect(changesOf(db, p.id)).toHaveLength(2);
  });
  test('T-002 К25 (б): с событием правятся норма, коэффициент и название', () => {
    const p = mk();
    rec(p.id, { type: 'purchase', qty: 500 });
    const r = updateProduct(db, p.id, { norm: 30, packageFactor: 1000, name: 'Кофе молотый' }, T_EDIT, defaultParams);
    expect(r.ok).toBe(true);
    expect(getProduct(db, p.id)).toMatchObject({ norm: 30, packageFactor: 1000, name: 'Кофе молотый', consumptionUnit: 'г' });
    expect(changesOf(db, p.id)).toHaveLength(2);
  });
  test('T-002 К25 (б′): с событием та же единица «г» — успех без новой записи', () => {
    const p = mk();
    rec(p.id, { type: 'purchase', qty: 500 });
    const r = updateProduct(db, p.id, { consumptionUnit: 'г' }, T_EDIT, defaultParams);
    expect(r.ok).toBe(true);
    expect(changesOf(db, p.id)).toHaveLength(1);
  });
});
