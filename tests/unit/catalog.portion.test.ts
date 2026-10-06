// T-001, К19–К24: порция по умолчанию и ручная. FR-CAT-08, Q-30, BR-10.
import { describe, expect, it } from 'vitest';
import { createProduct, editProduct, effectivePortion } from '../../src/domain/catalog.ts';
import { DAY, WEEK, days, norm, product, value } from '../support/products.ts';

const cheese = () => product({ name: 'Сыр', unit: 'г', norm: norm(42857, 300000, WEEK) });
const yogurt = () => product({ name: 'Йогурт', unit: 'шт', norm: norm(571, 4000, WEEK) });

describe('T-001 К19: порция по умолчанию — суточная норма (г, мл)', () => {
  it('T-001 К19: 300 г за неделю — 42857, позиция хранит порцию как не заданную', () => {
    const p = cheese();
    expect(effectivePortion(p)).toBe(42857);
    expect(p.portionMilli).toBeNull();
  });

  it('T-001 К19: то же при создании командой', () => {
    const p = value(createProduct({ name: 'Сыр', unit: 'г', normAmount: 300, normPeriod: WEEK }));
    expect(effectivePortion(p)).toBe(42857);
    expect(p.portionMilli).toBeNull();
  });
});

describe('T-001 К20: порция по умолчанию для «шт» — целая, не меньше 1', () => {
  it.each([
    [4, WEEK, 571, 1000],
    [2, WEEK, 286, 1000],
    [10, WEEK, 1429, 1000],
    [3, days(2), 1500, 2000],
    [3, DAY, 3000, 3000],
  ] as const)('T-001 К20: %d шт за %j (суточная %d) — порция %d', (amount, period, daily, portion) => {
    const p = value(createProduct({ name: 'X', unit: 'шт', normAmount: amount, normPeriod: period }));
    expect(p.norm?.dailyMilli).toBe(daily);
    expect(effectivePortion(p)).toBe(portion);
  });
});

describe('T-001 К21: порция по умолчанию следует за нормой', () => {
  it('T-001 К21: сыр 700 г за неделю — 100000', () => {
    const p = value(editProduct(cheese(), { normAmount: 700 }));
    expect(effectivePortion(p)).toBe(100000);
    expect(p.portionMilli).toBeNull();
  });

  it('T-001 К21: йогурт 14 шт за неделю — 2000', () => {
    const p = value(editProduct(yogurt(), { normAmount: 14 }));
    expect(effectivePortion(p)).toBe(2000);
    expect(p.portionMilli).toBeNull();
  });
});

describe('T-001 К22: ручная порция важнее нормы', () => {
  it('T-001 К22: кофе 15 г — до и после правки нормы', () => {
    const coffee = product({ norm: norm(30000, 30000, DAY), portionMilli: 15000 });
    expect(effectivePortion(coffee)).toBe(15000);
    const edited = value(editProduct(coffee, { normAmount: 40 }));
    expect(edited.norm?.dailyMilli).toBe(40000);
    expect(effectivePortion(edited)).toBe(15000);
    expect(edited.portionMilli).toBe(15000);
  });

  it('T-001 К22: «шт» 1,5 — не округляется и не меняется правкой нормы', () => {
    const p = { ...yogurt(), portionMilli: 1500 };
    expect(effectivePortion(p)).toBe(1500);
    const edited = value(editProduct(p, { normAmount: 14 }));
    expect(effectivePortion(edited)).toBe(1500);
    expect(edited.portionMilli).toBe(1500);
  });
});

describe('T-001 К23: нет нормы — нет порции по умолчанию', () => {
  it('T-001 К23: позиция без нормы и порции — null, норма пуста', () => {
    const p = product();
    expect(effectivePortion(p)).toBeNull();
    expect(p.norm).toBeNull();
  });
});

describe('T-001 К24: сброс нормы', () => {
  it('T-001 К24: у A порции нет, у B остаётся ручная; норма и период пусты', () => {
    const a = value(editProduct(cheese(), { normAmount: null, normPeriod: null }));
    const b = value(
      editProduct(product({ norm: norm(30000, 30000, DAY), portionMilli: 15000 }), {
        normAmount: null,
        normPeriod: null,
      }),
    );
    expect(a.norm).toBeNull();
    expect(b.norm).toBeNull();
    expect(effectivePortion(a)).toBeNull();
    expect(effectivePortion(b)).toBe(15000);
  });
});
