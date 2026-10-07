// T-004 К7, К17: каталог и признак «у позиции есть события остатка» (BR-05, инвариант 4).
import { afterEach, describe, expect, it } from 'vitest';
import { createProduct, updateProduct } from '../../../src/domain/catalog.ts';
import { added, cleanup, mkProduct, open, openFile, state, stock, T0 } from './helpers.ts';

afterEach(cleanup);

describe('T-004 К7: каталог — запись, чтение, правка', () => {
  const made = createProduct({ id: 'p-buckwheat', name: 'Гречка', unit: 'г', packName: 'пачка', unitsPerPack: 900 });
  if (!made.ok) throw new Error('тест: createProduct');
  const buckwheat = made.value;

  it('T-004 К7: прочитанное строго равно Product (поля без значения — null); после правки — равно результату updateProduct', () => {
    const s = open({ path: ':memory:', busyTimeoutMs: 5000 });
    expect(s.addProduct(buckwheat)).toStrictEqual({ status: 'added' });
    expect(s.getProduct('p-buckwheat')).toStrictEqual(buckwheat);
    expect(s.getProduct('p-buckwheat')?.category).toBeNull();
    expect(s.getProduct('p-buckwheat')?.norm).toBeNull();

    const edited = updateProduct(buckwheat, { norm: 40, unitsPerPack: 800 });
    if (!edited.ok) throw new Error('тест: updateProduct');
    expect(s.editProduct(edited.value)).toStrictEqual({ status: 'updated' });
    expect(s.getProduct('p-buckwheat')).toStrictEqual(edited.value);
    expect(s.getProduct('p-buckwheat')).toMatchObject({ norm: 40, unitsPerPack: 800 });
    s.close();
  });

  it('T-004 К7: список содержит все записанные; неизвестный id — undefined без исключения', () => {
    const s = open({ path: ':memory:', busyTimeoutMs: 5000 });
    const milk = mkProduct('p-milk', 'Молоко', 'мл', 1000);
    s.addProduct(buckwheat);
    s.addProduct(milk);
    const list = s.listProducts();
    expect(list).toHaveLength(2);
    expect(list).toContainEqual(buckwheat);
    expect(list).toContainEqual(milk);
    expect(s.getProduct('p-nope')).toBeUndefined();
    s.close();
  });

  it('T-004 К7: повторная запись с существующим id отклоняется, строка не меняется; правка неизвестной — отказ', () => {
    const s = open({ path: ':memory:', busyTimeoutMs: 5000 });
    s.addProduct(buckwheat);
    const other = mkProduct('p-buckwheat', 'Другая', 'шт', 10);
    expect(s.addProduct(other)).toStrictEqual({ status: 'exists' });
    expect(s.getProduct('p-buckwheat')).toStrictEqual(buckwheat);
    expect(s.listProducts()).toHaveLength(1);
    expect(s.editProduct(mkProduct('p-nope', 'Нет'))).toStrictEqual({ status: 'unknown_product' });
    expect(s.getProduct('p-nope')).toBeUndefined();
    s.close();
  });
});

describe('T-004 К17: признак «у позиции есть события остатка»', () => {
  it('T-004 К17: false до записи, true после порции и после её отмены; события состояния не меняют', () => {
    const { storage } = openFile();
    const p = mkProduct('p-buckwheat', 'Гречка');
    storage.addProduct(p);
    expect(storage.hasStockEvents(p.id)).toBe(false);

    added(storage.addStateEvent(state(p.id, 's-1', T0, 'inactive', 'user_button')));
    expect(storage.hasStockEvents(p.id)).toBe(false);

    const e = added(storage.addStockEvent(stock(p, 'e-1', 'portion', T0, { quantity: 100 })));
    expect(storage.hasStockEvents(p.id)).toBe(true);

    added(storage.addStockEvent(stock(p, 'c-1', 'cancel', '2026-10-12T09:10:00.000Z', { targetId: e.id })));
    expect(storage.hasStockEvents(p.id)).toBe(true);
    expect(storage.hasStockEvents('p-other')).toBe(false);
    storage.close();
  });
});
