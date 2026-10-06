// T-001 К5, К9, К3 (переведены на T-003): diffProduct и newProductAttrs — чистые функции.
import { describe, expect, test } from 'vitest';
import { diffProduct, newProductAttrs } from '../../src/domain/index.ts';
import type { Product } from '../../src/domain/index.ts';
import { milk } from '../helpers/products.ts';

const current: Product = { id: 'p-1', ...milk, active: true };

describe('T-001 К5, К9 (T-003): diffProduct', () => {
  test('T-003 К2: пустая правка — пустые before и after', () => {
    expect(diffProduct(current, {})).toEqual({ before: {}, after: {} });
  });
  test('T-003 К2: совпадающие с текущими и пропущенные (undefined) поля не учитываются', () => {
    expect(diffProduct(current, { minimum: 2, name: 'Молоко', unit: undefined })).toEqual({ before: {}, after: {} });
  });
  test('T-003 К2: изменённые поля — только они, before из текущих, after из правки', () => {
    expect(diffProduct(current, { minimum: 3, unit: 'упаковка', name: 'Молоко' })).toEqual({
      before: { minimum: 2, unit: 'бутылка' },
      after: { minimum: 3, unit: 'упаковка' },
    });
  });
  test('T-003 К2: очистка (null) и 0 — изменения; null поверх null — нет', () => {
    expect(diffProduct(current, { minimum: null })).toEqual({ before: { minimum: 2 }, after: { minimum: null } });
    expect(diffProduct(current, { minimum: 0 })).toEqual({ before: { minimum: 2 }, after: { minimum: 0 } });
    expect(diffProduct({ ...current, minimum: null }, { minimum: null, category: current.category })).toEqual({
      before: {}, after: {},
    });
  });
  test('T-003 К2: не карточные поля (id, active) игнорируются; текущая позиция не меняется', () => {
    const copy = structuredClone(current);
    expect(diffProduct(current, { id: 'other', active: false, foo: 1 })).toEqual({ before: {}, after: {} });
    expect(current).toEqual(copy);
  });
});

describe('T-001 К3 (T-003): newProductAttrs', () => {
  test('T-003 К1: только заданные (не null, не undefined) атрибуты', () => {
    expect(newProductAttrs({ ...milk, category: null, minimum: undefined })).toEqual({ name: 'Молоко', unit: 'бутылка' });
  });
  test('T-003 К1: минимум 0 сохраняется, null — нет; поля вне карточки не попадают', () => {
    expect(newProductAttrs({ ...milk, minimum: 0 })).toEqual({ ...milk, minimum: 0 });
    expect(newProductAttrs({ name: 'Соль', id: 'x', active: true, foo: 1 })).toEqual({ name: 'Соль' });
  });
});
