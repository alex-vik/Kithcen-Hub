// T-001 (отложено ревьюером): diffProduct и newProductAttrs — чистые функции, должны быть зелёными сразу.
import { describe, expect, test } from 'vitest';
import { diffProduct, newProductAttrs } from '../../src/domain/index.ts';
import type { Product } from '../../src/domain/index.ts';
import { coffee } from '../helpers/products.ts';

const current: Product = { id: 'p-1', ...coffee, active: true };

describe('T-001 К5, К9: diffProduct', () => {
  test('пустая правка — пустые before и after', () => {
    expect(diffProduct(current, {})).toEqual({ before: {}, after: {} });
  });
  test('совпадающие с текущими и пропущенные (undefined) поля не учитываются', () => {
    expect(diffProduct(current, { norm: 20, name: 'Кофе в зёрнах', portion: undefined })).toEqual({ before: {}, after: {} });
  });
  test('изменённые поля — только они, before из текущих, after из правки', () => {
    expect(diffProduct(current, { norm: 25, lowStockThreshold: 100, name: 'Кофе в зёрнах' })).toEqual({
      before: { norm: 20, lowStockThreshold: null },
      after: { norm: 25, lowStockThreshold: 100 },
    });
  });
  test('очистка поля (null) — изменение; null поверх null — нет', () => {
    expect(diffProduct(current, { portion: null, lowStockThreshold: null })).toEqual({
      before: { portion: 10 },
      after: { portion: null },
    });
  });
  test('не карточные поля (id, active) игнорируются; текущая позиция не меняется', () => {
    const copy = structuredClone(current);
    expect(diffProduct(current, { id: 'other', active: false, foo: 1 })).toEqual({ before: {}, after: {} });
    expect(current).toEqual(copy);
  });
});

describe('T-001 К3, К16: newProductAttrs', () => {
  test('только заданные (не null, не undefined) атрибуты карточки', () => {
    const { lowStockThreshold: _l, portion: _p, ...expected } = coffee;
    expect(newProductAttrs({ ...coffee, portion: undefined })).toEqual(expected);
  });
  test('все атрибуты заданы — все в результате; null и 0 различаются', () => {
    expect(newProductAttrs({ ...coffee, lowStockThreshold: 0 })).toEqual({ ...coffee, lowStockThreshold: 0 });
    expect(newProductAttrs({ name: 'Соль', consumptionUnit: 'г', norm: null })).toEqual({ name: 'Соль', consumptionUnit: 'г' });
  });
  test('поля вне карточки (id, active, foo) не попадают', () => {
    expect(newProductAttrs({ name: 'Соль', consumptionUnit: 'г', id: 'x', active: true, foo: 1 })).toEqual({
      name: 'Соль', consumptionUnit: 'г',
    });
  });
});
