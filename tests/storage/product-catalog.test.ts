// T-003: хранение каталога на базе :memory: с миграциями (ADR-002, ADR-003 раздел 4).
// Новые К1–К4; переведены T-001 К3, К5, К6, К7, К9, К10, К17.
import { beforeEach, describe, expect, test } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { defaultParams } from '../../src/domain/index.ts';
import { createProduct, getProduct, recordStockEvent, getStock, updateProduct } from '../../src/server/db/index.ts';
import { T_CREATE, T_EDIT, milk } from '../helpers/products.ts';
import { changesOf, count, newDb, rows } from '../helpers/db.ts';

let db: DatabaseSync;
beforeEach(() => {
  db = newDb();
});

function mk(input: Record<string, unknown> = milk, at = T_CREATE, params = defaultParams) {
  const r = createProduct(db, input, at, params);
  if (!r.ok) throw new Error('создание отклонено: ' + JSON.stringify(r.errors));
  return r.product;
}
function edit(id: unknown, patch: Record<string, unknown>, at = T_EDIT) {
  const r = updateProduct(db, id, patch, at, defaultParams);
  if (!r.ok) throw new Error('правка отклонена: ' + JSON.stringify(r.errors));
  return r.product;
}
const buy = (productId: string, qty: number) => {
  const r = recordStockEvent(db, { id: `buy-${productId}`, productId, type: 'purchase', qty }, T_CREATE);
  if (!r.ok) throw new Error('событие отклонено: ' + JSON.stringify(r.errors));
};

describe('T-003 К1: позиция создаётся одним названием (FR-CAT-07, BR-10)', () => {
  test('T-003 К1: единица «шт», категория и минимум пусты, активна, одна запись create', () => {
    const p = mk({ name: 'Гречка' });
    expect(getProduct(db, p.id)).toMatchObject({
      name: 'Гречка', unit: 'шт', category: null, minimum: null, active: true,
    });
    const ch = changesOf(db, p.id);
    expect(ch).toHaveLength(1);
    expect(ch[0]!.kind).toBe('create');
  });
  test('T-003 К1: единица по умолчанию — первый элемент countUnits', () => {
    const p = mk({ name: 'Гречка' }, T_CREATE, { ...defaultParams, countUnits: ['ящик', 'шт'] });
    expect(getProduct(db, p.id)?.unit).toBe('ящик');
  });
});

describe('T-003 К2: атрибуты правятся, единица — в любой момент (FR-CAT-01, FR-CAT-02, Р-2)', () => {
  // [название, поле, новое значение]
  const cases: [string, string, unknown][] = [
    ['название', 'name', 'Молоко 3,2%'],
    ['категория', 'category', 'Другое'],
    ['минимум 5', 'minimum', 5],
    ['минимум 0', 'minimum', 0],
    ['минимум пусто', 'minimum', null],
    ['единица «упаковка» при наличии событий', 'unit', 'упаковка'],
  ];
  test.each(cases)('T-003 К2: %s', (_n, field, value) => {
    const p = mk();
    buy(p.id, 6);
    const returned = edit(p.id, { [field]: value });
    expect(getProduct(db, p.id)).toMatchObject({ ...milk, [field]: value });
    expect(returned).toMatchObject({ ...milk, [field]: value });
    const ch = changesOf(db, p.id);
    expect(ch).toHaveLength(2);
    expect(JSON.parse(ch[1]!.before as string)).toEqual({ [field]: (milk as Record<string, unknown>)[field] });
    expect(JSON.parse(ch[1]!.after as string)).toEqual({ [field]: value });
    expect(getStock(db, p.id)?.balance).toBe(6);
  });
});

describe('T-003 К3: недопустимый ввод позиции отклоняется без записи', () => {
  const bad: [string, string, unknown][] = [
    ['пустое название', 'name', ''],
    ['единица «г»', 'unit', 'г'],
    ['единица «кг»', 'unit', 'кг'],
    ['категория вне списка', 'category', 'Фрукты'],
    ['минимум −1', 'minimum', -1],
  ];
  test.each(bad)('T-003 К3 создание: %s', (_n, field, value) => {
    const r = createProduct(db, { name: 'Гречка', [field]: value }, T_CREATE, defaultParams);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toContain(field);
    expect(count(db, 'products')).toBe(0);
    expect(count(db, 'product_changes')).toBe(0);
  });
  test('T-003 К3 создание: название не задано', () => {
    expect(createProduct(db, {}, T_CREATE, defaultParams).ok).toBe(false);
    expect(count(db, 'products')).toBe(0);
    expect(count(db, 'product_changes')).toBe(0);
  });

  const editCases: [string, string, unknown][] = [...bad, ['единица очищена (Р-5)', 'unit', null]];
  test.each(editCases)('T-003 К3 правка: %s', (_n, field, value) => {
    const p = mk();
    const before = getProduct(db, p.id);
    const r = updateProduct(db, p.id, { [field]: value }, T_EDIT, defaultParams);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toContain(field);
    expect(getProduct(db, p.id)).toEqual(before);
    expect(changesOf(db, p.id)).toHaveLength(1);
  });

  test('T-003 К3: при countUnits = [«ящик»] «ящик» принимается, «шт» отклоняется', () => {
    const params = { ...defaultParams, countUnits: ['ящик'] };
    expect(createProduct(db, { name: 'Пиво', unit: 'ящик' }, T_CREATE, params).ok).toBe(true);
    expect(createProduct(db, { name: 'Пиво', unit: 'шт' }, T_CREATE, params).ok).toBe(false);
    expect(count(db, 'products')).toBe(1);
  });
});

describe('T-003 К4: старой модели нет в схеме (инвариант 1)', () => {
  const colsOf = (t: string) => rows(db, `SELECT name FROM pragma_table_info('${t}')`).map((r) => r.name as string).sort();
  test('T-003 К4: колонки products — ровно перечень', () => {
    expect(colsOf('products')).toEqual(['id', 'name', 'category', 'unit', 'minimum', 'active', 'created_at'].sort());
  });
  test('T-003 К4: колонки stock_events — ровно перечень', () => {
    expect(colsOf('stock_events')).toEqual(
      ['seq', 'id', 'product_id', 'type', 'qty', 'occurred_at', 'recorded_at', 'target_id'].sort(),
    );
  });
  test('T-003 К4: таблицы — только каталог и журналы', () => {
    const tables = rows(db, `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .map((r) => r.name as string).sort();
    expect(tables).toEqual(['product_changes', 'products', 'stock_events']);
  });
});

describe('T-001 К3 (T-003): создание пишет запись в журнал изменений', () => {
  test('T-003 К1: одна запись create/user/at, before пуст, after с заданными атрибутами', () => {
    const p = mk();
    const ch = changesOf(db, p.id);
    expect(ch).toHaveLength(1);
    const c = ch[0]!;
    expect(c.kind).toBe('create');
    expect(c.actor).toBe('user');
    expect(c.at).toBe(T_CREATE.epochMilliseconds);
    expect(c.before).toBeNull();
    expect(JSON.parse(c.after as string)).toMatchObject(milk);
  });
});

describe('T-001 К5 (T-003): правка пишет различия', () => {
  test('T-003 К2: только изменённые поля в before/after, kind update, actor user, at', () => {
    const p = mk();
    edit(p.id, { minimum: 3, unit: 'упаковка', name: 'Молоко' });
    const c = changesOf(db, p.id)[1]!;
    expect(c.kind).toBe('update');
    expect(c.actor).toBe('user');
    expect(c.at).toBe(T_EDIT.epochMilliseconds);
    expect(JSON.parse(c.before as string)).toEqual({ minimum: 2, unit: 'бутылка' });
    expect(JSON.parse(c.after as string)).toEqual({ minimum: 3, unit: 'упаковка' });
  });
});

describe('T-001 К6 (T-003): правка и запись изменения атомарны', () => {
  test('T-003 К2: падение записи журнала откатывает правку', () => {
    const p = mk();
    db.exec(`CREATE TRIGGER test_fail BEFORE INSERT ON product_changes
             BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);
    expect(() => updateProduct(db, p.id, { minimum: 99 }, T_EDIT, defaultParams)).toThrow();
    expect(getProduct(db, p.id)?.minimum).toBe(2);
    db.exec('DROP TRIGGER test_fail');
    expect(changesOf(db, p.id)).toHaveLength(1);
  });
});

describe('T-001 К7 (T-003): журнал изменений неизменяем (инвариант 2)', () => {
  test('T-003 К2: UPDATE отклоняется', () => {
    const p = mk();
    const snap = changesOf(db, p.id);
    expect(() => db.exec(`UPDATE product_changes SET actor = 'system'`)).toThrow();
    expect(changesOf(db, p.id)).toEqual(snap);
  });
  test('T-003 К2: DELETE отклоняется', () => {
    const p = mk();
    const snap = changesOf(db, p.id);
    expect(() => db.exec('DELETE FROM product_changes')).toThrow();
    expect(changesOf(db, p.id)).toEqual(snap);
  });
});

describe('T-001 К9 (T-003): правка без изменений ничего не пишет', () => {
  test('T-003 К2: (а) пустая правка, (б) совпадающие значения', () => {
    const p = mk();
    const before = getProduct(db, p.id);
    expect(updateProduct(db, p.id, {}, T_EDIT, defaultParams).ok).toBe(true);
    expect(updateProduct(db, p.id, { minimum: 2, name: 'Молоко', unit: 'бутылка' }, T_EDIT, defaultParams).ok).toBe(true);
    expect(changesOf(db, p.id)).toHaveLength(1);
    expect(getProduct(db, p.id)).toEqual(before);
  });
});

describe('T-001 К10 (T-003): название не обязано быть уникальным', () => {
  test('T-003 К1: две позиции «Молоко»', () => {
    const a = mk();
    const b = mk();
    expect(b.id).not.toEqual(a.id);
    expect(rows(db, 'SELECT id FROM products WHERE name = ?', 'Молоко')).toHaveLength(2);
  });
});

describe('T-001 К17 (T-003): активность', () => {
  test('T-003 К2: активна после создания и после правки, в журнале нет active', () => {
    const p = mk();
    expect(getProduct(db, p.id)?.active).toBe(true);
    edit(p.id, { minimum: 3 });
    expect(getProduct(db, p.id)?.active).toBe(true);
    const c = changesOf(db, p.id)[1]!;
    expect(JSON.parse(c.before as string)).not.toHaveProperty('active');
    expect(JSON.parse(c.after as string)).not.toHaveProperty('active');
  });
});
