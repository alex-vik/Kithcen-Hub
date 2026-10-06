// T-001: хранение каталога на базе :memory: с миграциями (ADR-002, ADR-003 раздел 4). К1–К10, К12–К15, К16 (хвост), К17–К19.
import { beforeEach, describe, expect, test } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { defaultParams, packagesToUnits } from '../../src/domain/index.ts';
import { createProduct, getProduct, updateProduct } from '../../src/server/db/index.ts';
import { T_CREATE, T_EDIT, coffee } from '../helpers/products.ts';
import { changesOf, count, newDb, rows } from '../helpers/db.ts';

let db: DatabaseSync;
beforeEach(() => {
  db = newDb();
});

// Создание, которое должно удаться; возвращает позицию.
function mk(input: Record<string, unknown> = coffee, at = T_CREATE) {
  const r = createProduct(db, input, at, defaultParams);
  if (!r.ok) throw new Error('создание отклонено: ' + JSON.stringify(r.errors));
  return r.product;
}
function edit(id: unknown, patch: Record<string, unknown>, at = T_EDIT) {
  const r = updateProduct(db, id, patch, at, defaultParams);
  if (!r.ok) throw new Error('правка отклонена: ' + JSON.stringify(r.errors));
  return r.product;
}

describe('T-001 К1: создание со всеми атрибутами', () => {
  test('T-001 К1: чтение возвращает те же значения и «активна»', () => {
    const created = mk();
    const read = getProduct(db, created.id);
    expect(read).toMatchObject(coffee);
    expect(read?.active).toBe(true);
  });
});

describe('T-001 К2: только обязательные атрибуты (BR-10)', () => {
  test('T-001 К2: необязательные пусты (null), не 0', () => {
    const p = mk({ name: 'Гречка', consumptionUnit: 'г' });
    const read = getProduct(db, p.id);
    expect(read).toMatchObject({
      name: 'Гречка', consumptionUnit: 'г', norm: null, lowStockThreshold: null, portion: null,
      packageFactor: null, packageName: null, category: null, writeOffType: null, active: true,
    });
  });
});

describe('T-001 К3: создание пишет запись в журнал изменений', () => {
  test('T-001 К3: одна запись create/user/at, before пуст, after со всеми атрибутами', () => {
    const p = mk();
    const ch = changesOf(db, p.id);
    expect(ch).toHaveLength(1);
    const c = ch[0]!;
    expect(c.kind).toBe('create');
    expect(c.actor).toBe('user');
    expect(c.at).toBe(T_CREATE.epochMilliseconds);
    expect(c.before).toBeNull();
    const after = JSON.parse(c.after as string);
    const { lowStockThreshold: _unset, ...given } = coffee;
    expect(after).toMatchObject(given);
  });
});

describe('T-001 К4: правка каждого атрибута вручную (FR-CAT-02)', () => {
  const cases: [string, unknown][] = [
    ['name', 'Кофе молотый'],
    ['category', 'Другое'],
    ['writeOffType', 'рывковый'],
    ['consumptionUnit', 'шт'],
    ['packageName', 'банка'],
    ['packageFactor', 1000],
    ['norm', 25],
    ['lowStockThreshold', 100],
    ['portion', 15],
  ];
  test.each(cases)('T-001 К4: правка %s', (field, value) => {
    const p = mk();
    const after = edit(p.id, { [field]: value });
    const read = getProduct(db, p.id);
    expect(read).toMatchObject({ ...coffee, [field]: value });
    expect(after).toMatchObject({ ...coffee, [field]: value });
  });
});

describe('T-001 К5: правка пишет различия', () => {
  test('T-001 К5: только изменённые поля в before/after', () => {
    const p = mk();
    edit(p.id, { norm: 25, lowStockThreshold: 100 });
    const ch = changesOf(db, p.id);
    expect(ch).toHaveLength(2);
    const c = ch[1]!;
    expect(c.kind).toBe('update');
    expect(c.actor).toBe('user');
    expect(c.at).toBe(T_EDIT.epochMilliseconds);
    expect(JSON.parse(c.before as string)).toEqual({ norm: 20, lowStockThreshold: null });
    expect(JSON.parse(c.after as string)).toEqual({ norm: 25, lowStockThreshold: 100 });
  });
});

describe('T-001 К6: правка и запись изменения атомарны', () => {
  test('T-001 К6: падение записи журнала откатывает правку', () => {
    const p = mk();
    db.exec(`CREATE TRIGGER test_fail BEFORE INSERT ON product_changes
             BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);
    expect(() => updateProduct(db, p.id, { norm: 99 }, T_EDIT, defaultParams)).toThrow();
    expect(getProduct(db, p.id)?.norm).toBe(20);
    db.exec('DROP TRIGGER test_fail');
    expect(changesOf(db, p.id)).toHaveLength(1);
  });
});

describe('T-001 К7: журнал изменений неизменяем', () => {
  test('T-001 К7: UPDATE отклоняется', () => {
    const p = mk();
    const snap = changesOf(db, p.id);
    expect(() => db.exec(`UPDATE product_changes SET actor = 'system'`)).toThrow();
    expect(changesOf(db, p.id)).toEqual(snap);
  });
  test('T-001 К7: DELETE отклоняется', () => {
    const p = mk();
    const snap = changesOf(db, p.id);
    expect(() => db.exec('DELETE FROM product_changes')).toThrow();
    expect(changesOf(db, p.id)).toEqual(snap);
  });
});

describe('T-001 К8: остаток не хранится (инвариант 1)', () => {
  test('T-001 К8: колонки products — зафиксированный перечень', () => {
    const cols = rows(db, `SELECT name FROM pragma_table_info('products')`).map((r) => r.name as string);
    expect([...cols].sort()).toEqual(
      [
        'id', 'name', 'category', 'write_off_type', 'consumption_unit', 'package_name', 'package_factor',
        'norm', 'low_stock_threshold', 'portion', 'active', 'created_at',
      ].sort(),
    );
  });
});

describe('T-001 К9: правка без изменений ничего не пишет', () => {
  test('T-001 К9: (а) пустая правка, (б) совпадающие значения', () => {
    const p = mk();
    const before = getProduct(db, p.id);
    expect(updateProduct(db, p.id, {}, T_EDIT, defaultParams).ok).toBe(true);
    expect(updateProduct(db, p.id, { norm: 20, name: 'Кофе в зёрнах' }, T_EDIT, defaultParams).ok).toBe(true);
    expect(changesOf(db, p.id)).toHaveLength(1);
    expect(getProduct(db, p.id)).toEqual(before);
  });
});

describe('T-001 К10: название не обязано быть уникальным', () => {
  test('T-001 К10: две позиции «Кофе в зёрнах»', () => {
    const a = mk();
    const b = mk();
    expect(b.id).not.toEqual(a.id);
    expect(rows(db, 'SELECT id FROM products WHERE name = ?', 'Кофе в зёрнах')).toHaveLength(2);
  });
});

describe('T-001 К12: смена коэффициента пишется в журнал', () => {
  test('T-001 К12: пересчёт 500, затем before 250 / after 1000', () => {
    const p = mk();
    expect(packagesToUnits(2, p.packageFactor)).toBe(500);
    edit(p.id, { packageFactor: 1000 });
    const c = changesOf(db, p.id)[1]!;
    expect(JSON.parse(c.before as string)).toEqual({ packageFactor: 250 });
    expect(JSON.parse(c.after as string)).toEqual({ packageFactor: 1000 });
  });
});

describe('T-001 К13: разные размеры упаковки — одна позиция (BR-04)', () => {
  test('T-001 К13: одна позиция «Молоко», в модели нет размера упаковки помимо коэффициента', () => {
    const milk = mk({
      name: 'Молоко', consumptionUnit: 'мл', packageName: 'бутылка', packageFactor: 1000,
    });
    expect(packagesToUnits(1, milk.packageFactor)).toBe(1000);
    expect(packagesToUnits(1, 500)).toBe(500);
    expect(rows(db, 'SELECT id FROM products WHERE name = ?', 'Молоко')).toHaveLength(1);
    const sizeKeys = Object.keys(milk).filter((k) => /size|volume|weight/i.test(k));
    expect(sizeKeys).toEqual([]);
  });
});

describe('T-001 К14: разные единицы — независимые позиции (BR-05)', () => {
  test('T-001 К14: правка зёрен не трогает капсулы', () => {
    const beans = mk({ ...coffee, name: 'Кофе в зёрнах' });
    const caps = mk({ name: 'Кофе в капсулах', consumptionUnit: 'шт', norm: 2, portion: 1 });
    edit(beans.id, { norm: 30, portion: 12 });
    expect(getProduct(db, caps.id)).toMatchObject({ norm: 2, portion: 1 });
    expect(changesOf(db, caps.id)).toHaveLength(1);
    expect(changesOf(db, beans.id)).toHaveLength(2);
  });
});

describe('T-001 К15: ручная порция не переписывается нормой', () => {
  test('T-001 К15: норма 30, порция остаётся 10, в журнале нет порции', () => {
    const p = mk();
    edit(p.id, { norm: 30 });
    expect(getProduct(db, p.id)?.portion).toBe(10);
    const c = changesOf(db, p.id)[1]!;
    expect(JSON.parse(c.before as string)).not.toHaveProperty('portion');
    expect(JSON.parse(c.after as string)).not.toHaveProperty('portion');
  });
});

describe('T-001 К16 (хвост): предложенная порция не пишется в базу', () => {
  test('T-001 К16: позиция без порции — portion пусто, в create порции нет', () => {
    const { portion: _p, ...noPortion } = coffee;
    const p = mk(noPortion);
    expect(getProduct(db, p.id)?.portion).toBeNull();
    const after = JSON.parse(changesOf(db, p.id)[0]!.after as string);
    expect(after.portion ?? null).toBeNull();
  });
});

describe('T-001 К17: активность', () => {
  test('T-001 К17: активна после создания и после правки, в журнале нет active', () => {
    const p = mk();
    expect(getProduct(db, p.id)?.active).toBe(true);
    edit(p.id, { norm: 25 });
    expect(getProduct(db, p.id)?.active).toBe(true);
    const c = changesOf(db, p.id)[1]!;
    expect(JSON.parse(c.before as string)).not.toHaveProperty('active');
    expect(JSON.parse(c.after as string)).not.toHaveProperty('active');
  });
});

describe('T-001 К18 (хранение): недопустимый ввод отклоняется без записи', () => {
  const base = { name: 'Гречка', consumptionUnit: 'г' };
  const bad: [string, string, unknown][] = [
    ['пустое название', 'name', ''],
    ['название из пробелов', 'name', '   '],
    ['единица «гр»', 'consumptionUnit', 'гр'],
    ['единица «кг»', 'consumptionUnit', 'кг'],
    ['категория «Фрукты»', 'category', 'Фрукты'],
    ['тип списания вне множества', 'writeOffType', 'частый'],
    ['коэффициент 0', 'packageFactor', 0],
    ['коэффициент -1', 'packageFactor', -1],
    ['порция 0', 'portion', 0],
    ['порция -1', 'portion', -1],
    ['норма -1', 'norm', -1],
    ['нижний порог -1', 'lowStockThreshold', -1],
  ];

  test.each(bad)('T-001 К18 создание: %s', (_n, field, value) => {
    const r = createProduct(db, { ...base, [field]: value }, T_CREATE, defaultParams);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toContain(field);
    expect(count(db, 'products')).toBe(0);
    expect(count(db, 'product_changes')).toBe(0);
  });

  test('T-001 К18 создание: название не задано', () => {
    const r = createProduct(db, { consumptionUnit: 'г' }, T_CREATE, defaultParams);
    expect(r.ok).toBe(false);
    expect(count(db, 'products')).toBe(0);
    expect(count(db, 'product_changes')).toBe(0);
  });
  test('T-001 К18 создание: единица не задана', () => {
    const r = createProduct(db, { name: 'Гречка' }, T_CREATE, defaultParams);
    expect(r.ok).toBe(false);
    expect(count(db, 'products')).toBe(0);
    expect(count(db, 'product_changes')).toBe(0);
  });

  const editCases: [string, string, unknown][] = [...bad, ['единица очищена', 'consumptionUnit', null]];
  test.each(editCases)('T-001 К18 правка: %s', (_n, field, value) => {
    const p = mk();
    const before = getProduct(db, p.id);
    const r = updateProduct(db, p.id, { [field]: value }, T_EDIT, defaultParams);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toContain(field);
    expect(getProduct(db, p.id)).toEqual(before);
    expect(changesOf(db, p.id)).toHaveLength(1);
  });
});

describe('T-001 К19: граничные допустимые значения', () => {
  test('T-001 К19: норма 0 и порог 0 хранятся как 0, остальное пусто', () => {
    const p = mk({ name: 'Соль', consumptionUnit: 'г', norm: 0, lowStockThreshold: 0 });
    const read = getProduct(db, p.id);
    expect(read).toMatchObject({
      norm: 0, lowStockThreshold: 0, packageFactor: null, category: null, writeOffType: null, portion: null,
    });
  });
});
