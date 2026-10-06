// T-003: доменные чистые функции каталога — без базы (ADR-004). К3 (домен), К4 (контракт домена).
import { describe, expect, test } from 'vitest';
import * as domain from '../../src/domain/index.ts';
import { defaultParams, validateNewProduct, validateProductPatch } from '../../src/domain/index.ts';
import { milk } from '../helpers/products.ts';

const fieldsOf = (r: { ok: boolean; errors?: { field: string }[] }): string[] =>
  r.ok ? [] : (r.errors ?? []).map((e) => e.field);

describe('T-003 К3: недопустимый ввод — ошибка с именем поля (домен)', () => {
  const bad: [string, string, unknown][] = [
    ['пустое название', 'name', ''],
    ['название из пробелов', 'name', '   '],
    ['единица «г»', 'unit', 'г'],
    ['единица «кг»', 'unit', 'кг'],
    ['категория вне списка', 'category', 'Фрукты'],
    ['минимум -1', 'minimum', -1],
  ];

  test.each(bad)('T-003 К3 создание: %s', (_n, field, value) => {
    const r = validateNewProduct({ name: 'Гречка', [field]: value }, defaultParams);
    expect(r.ok).toBe(false);
    expect(fieldsOf(r)).toContain(field);
  });
  test('T-003 К3 создание: название не задано', () => {
    expect(fieldsOf(validateNewProduct({}, defaultParams))).toContain('name');
  });
  test.each(bad)('T-003 К3 правка: %s', (_n, field, value) => {
    const r = validateProductPatch({ [field]: value }, defaultParams);
    expect(r.ok).toBe(false);
    expect(fieldsOf(r)).toContain(field);
  });
  test('T-003 К3 правка: единица очищена (Р-5)', () => {
    expect(fieldsOf(validateProductPatch({ unit: null }, defaultParams))).toContain('unit');
  });
  test('T-003 К3: допустимый ввод проходит, в том числе одно название, минимум 0 и пустой минимум', () => {
    expect(validateNewProduct({ ...milk }, defaultParams).ok).toBe(true);
    expect(validateNewProduct({ name: 'Гречка' }, defaultParams).ok).toBe(true);
    expect(validateNewProduct({ name: 'Соль', minimum: 0 }, defaultParams).ok).toBe(true);
    expect(validateProductPatch({ minimum: null, category: null }, defaultParams).ok).toBe(true);
    expect(validateProductPatch({ unit: 'упаковка' }, defaultParams).ok).toBe(true);
    expect(validateProductPatch({}, defaultParams).ok).toBe(true);
  });
  test('T-003 К3: список единиц — из params.countUnits', () => {
    const params = { ...defaultParams, countUnits: ['ящик'] };
    expect(validateNewProduct({ name: 'X', unit: 'ящик' }, params).ok).toBe(true);
    expect(fieldsOf(validateNewProduct({ name: 'X', unit: 'шт' }, params))).toContain('unit');
    expect(fieldsOf(validateProductPatch({ unit: 'шт' }, params))).toContain('unit');
  });
});

describe('T-003 К4: старой модели нет в контракте домена', () => {
  test('T-003 К4: нет suggestPortion, packagesToUnits, validateUnitChange', () => {
    for (const name of ['suggestPortion', 'packagesToUnits', 'validateUnitChange']) {
      expect(domain).not.toHaveProperty(name);
    }
  });
  test('T-003 К4: в defaultParams нет suggestedPortionShare и consumptionUnits', () => {
    expect(defaultParams).not.toHaveProperty('suggestedPortionShare');
    expect(defaultParams).not.toHaveProperty('consumptionUnits');
  });
  test('T-003 К4: перечень типов событий — ровно purchase, used, ran_out, recount', () => {
    expect([...domain.stockEventTypes].sort()).toEqual(['purchase', 'ran_out', 'recount', 'used']);
  });
  test('T-003 К3: умолчания — единицы счёта и 12 категорий', () => {
    expect(defaultParams.countUnits).toEqual(['шт', 'пачка', 'бутылка', 'банка', 'пакет', 'упаковка']);
    expect(defaultParams.productCategories).toEqual([
      'Молочное и яйца', 'Мясо и рыба', 'Овощи и фрукты', 'Хлеб и выпечка', 'Крупы и макароны',
      'Консервы и соусы', 'Специи и бакалея', 'Заморозка', 'Напитки', 'Сладкое и снеки', 'Бытовое', 'Другое',
    ]);
  });
});
