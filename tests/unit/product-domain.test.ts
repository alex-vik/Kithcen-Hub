// T-001: доменные чистые функции каталога — без базы (ADR-004). К11, К12 (часть), К13 (часть), К16, К18 (домен), К20.
import { describe, expect, test } from 'vitest';
import {
  defaultParams,
  packagesToUnits,
  suggestPortion,
  validateNewProduct,
  validateProductPatch,
} from '../../src/domain/index.ts';
import { coffee } from '../helpers/products.ts';

const fieldsOf = (r: { ok: boolean; errors?: { field: string }[] }): string[] =>
  r.ok ? [] : (r.errors ?? []).map((e) => e.field);

describe('T-001 К11: упаковки пересчитываются в расходные единицы (BR-03)', () => {
  test('T-001 К11: 2 упаковки по 250 = 500', () => {
    expect(packagesToUnits(2, 250)).toBe(500);
  });
});

describe('T-001 К12: пересчёт не трогает позицию', () => {
  test('T-001 К12: результат 500, объект позиции не изменён', () => {
    const product = Object.freeze({ ...coffee });
    const before = structuredClone(product);
    expect(packagesToUnits(2, product.packageFactor)).toBe(500);
    expect(product).toEqual(before);
  });
});

describe('T-001 К13: разные размеры упаковки — одна позиция (BR-04)', () => {
  test('T-001 К13: 1 упаковка по 1000 и по 500', () => {
    expect(packagesToUnits(1, 1000)).toBe(1000);
    expect(packagesToUnits(1, 500)).toBe(500);
  });
});

describe('T-001 К16: предложенная порция из нормы по параметру (FR-CAT-08)', () => {
  const cases: [string, { norm: number | null; portion: number | null }, number, number | null][] = [
    ['норма 20, порции нет, доля 1,0', { norm: 20, portion: null }, 1.0, 20],
    ['норма 20, порции нет, доля 0,5 (из params)', { norm: 20, portion: null }, 0.5, 10],
    ['норма 30, ручная 10 — ручная в приоритете', { norm: 30, portion: 10 }, 1.0, 10],
    ['нормы нет, ручная 5', { norm: null, portion: 5 }, 1.0, 5],
    ['нормы нет, порции нет — пусто', { norm: null, portion: null }, 1.0, null],
  ];
  test.each(cases)('T-001 К16: %s', (_name, product, share, expected) => {
    const params = { ...defaultParams, suggestedPortionShare: share };
    expect(suggestPortion(product, params)).toBe(expected);
  });
  test('T-001 К16: значение по умолчанию suggestedPortionShare = 1,0', () => {
    expect(defaultParams.suggestedPortionShare).toBe(1.0);
  });
});

describe('T-001 К18: недопустимый ввод — ошибка с именем поля (домен)', () => {
  const base = { name: 'Гречка', consumptionUnit: 'г' };
  // [описание, поле, значение]
  const bad: [string, string, unknown][] = [
    ['пустое название', 'name', ''],
    ['название из пробелов', 'name', '   '],
    ['единица вне списка «гр»', 'consumptionUnit', 'гр'],
    ['единица вне списка «кг»', 'consumptionUnit', 'кг'],
    ['категория вне списка', 'category', 'Фрукты'],
    ['тип списания вне множества', 'writeOffType', 'частый'],
    ['коэффициент 0', 'packageFactor', 0],
    ['коэффициент -1', 'packageFactor', -1],
    ['порция 0', 'portion', 0],
    ['порция -1', 'portion', -1],
    ['норма -1', 'norm', -1],
    ['нижний порог -1', 'lowStockThreshold', -1],
  ];

  test.each(bad)('T-001 К18 создание: %s', (_n, field, value) => {
    const r = validateNewProduct({ ...base, [field]: value }, defaultParams);
    expect(r.ok).toBe(false);
    expect(fieldsOf(r)).toContain(field);
  });

  test('T-001 К18 создание: название не задано', () => {
    const r = validateNewProduct({ consumptionUnit: 'г' }, defaultParams);
    expect(fieldsOf(r)).toContain('name');
  });
  test('T-001 К18 создание: расходная единица не задана', () => {
    const r = validateNewProduct({ name: 'Гречка' }, defaultParams);
    expect(fieldsOf(r)).toContain('consumptionUnit');
  });

  test.each(bad)('T-001 К18 правка: %s', (_n, field, value) => {
    const r = validateProductPatch({ [field]: value }, defaultParams);
    expect(r.ok).toBe(false);
    expect(fieldsOf(r)).toContain(field);
  });
  test('T-001 К18 правка: расходная единица очищена', () => {
    const r = validateProductPatch({ consumptionUnit: null }, defaultParams);
    expect(fieldsOf(r)).toContain('consumptionUnit');
  });

  test('T-001 К18: допустимый ввод проходит', () => {
    expect(validateNewProduct({ ...coffee }, defaultParams).ok).toBe(true);
    expect(validateProductPatch({ norm: 25 }, defaultParams).ok).toBe(true);
    expect(validateProductPatch({}, defaultParams).ok).toBe(true);
  });
});

describe('T-001 К19 (домен): граничные значения', () => {
  test('T-001 К19: норма 0 и порог 0 допустимы', () => {
    const r = validateNewProduct({ name: 'Соль', consumptionUnit: 'г', norm: 0, lowStockThreshold: 0 }, defaultParams);
    expect(r.ok).toBe(true);
  });
});

describe('T-001 К20: списки единиц и категорий — из params', () => {
  const params = { ...defaultParams, consumptionUnits: ['г', 'кг'], productCategories: ['Тестовая'] };
  test('T-001 К20: единица «кг» и категория «Тестовая» проходят', () => {
    expect(validateNewProduct({ name: 'X', consumptionUnit: 'кг', category: 'Тестовая' }, params).ok).toBe(true);
  });
  test('T-001 К20: единица «шт» и категория «Напитки» отклоняются', () => {
    const r = validateNewProduct({ name: 'X', consumptionUnit: 'шт', category: 'Напитки' }, params);
    expect(r.ok).toBe(false);
    expect(fieldsOf(r)).toEqual(expect.arrayContaining(['consumptionUnit', 'category']));
  });
  test('T-001 К20: умолчания — г, мл, шт и 12 категорий', () => {
    expect(defaultParams.consumptionUnits).toEqual(['г', 'мл', 'шт']);
    expect(defaultParams.productCategories).toEqual([
      'Молочное и яйца', 'Мясо и рыба', 'Овощи и фрукты', 'Хлеб и выпечка', 'Крупы и макароны',
      'Консервы и соусы', 'Специи и бакалея', 'Заморозка', 'Напитки', 'Сладкое и снеки', 'Бытовое', 'Другое',
    ]);
  });
});
