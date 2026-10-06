// T-001, К1–К14: создание позиции, норма за период, BR-05. FR-CAT-01, FR-CAT-08, BR-03, BR-05, BR-10.
import { describe, expect, it } from 'vitest';
import { createProduct, dailyNormMilli, editProduct, effectivePortion } from '../../src/domain/catalog.ts';
import { DAY, WEEK, days, errorOf, norm, value } from '../support/products.ts';

describe('T-001 К1: минимальная позиция', () => {
  it('T-001 К1: название и единица — остальное пусто, позиция активна', () => {
    const p = value(createProduct({ name: 'Гречка', unit: 'г' }));
    expect(p).toEqual({
      name: 'Гречка',
      category: null,
      writeOffType: null,
      unit: 'г',
      pack: null,
      norm: null,
      lowThresholdMilli: null,
      portionMilli: null,
      active: true,
    });
  });
});

describe('T-001 К2: полная позиция', () => {
  it('T-001 К2: все значения переведены в тысячные доли', () => {
    const p = value(
      createProduct({
        name: 'Кофе молотый',
        category: 'Напитки',
        writeOffType: 'rhythmic',
        unit: 'г',
        packName: 'пачка',
        packSize: 250,
        normAmount: 30,
        normPeriod: DAY,
        lowThreshold: 100,
        portion: 15,
      }),
    );
    expect(p).toEqual({
      name: 'Кофе молотый',
      category: 'Напитки',
      writeOffType: 'rhythmic',
      unit: 'г',
      pack: { name: 'пачка', sizeMilli: 250000 },
      norm: { dailyMilli: 30000, enteredMilli: 30000, period: DAY },
      lowThresholdMilli: 100000,
      portionMilli: 15000,
      active: true,
    });
  });
});

describe('T-001 К3: норма не выставляется сама (BR-10)', () => {
  it('T-001 К3: коэффициент и порция не превращаются в норму', () => {
    const p = value(
      createProduct({ name: 'Рис', unit: 'г', packName: 'пачка', packSize: 250, portion: 15 }),
    );
    expect(p.norm).toBeNull();
    expect(p.pack).toEqual({ name: 'пачка', sizeMilli: 250000 });
    expect(p.portionMilli).toBe(15000);
  });
});

describe('T-001 К4: расходные единицы', () => {
  it.each(['г', 'мл', 'шт'])('T-001 К4: единица «%s» допустима', (unit) => {
    expect(value(createProduct({ name: 'X', unit })).unit).toBe(unit);
  });

  it('T-001 К4: единица «пачка» — отказ unit', () => {
    expect(errorOf(createProduct({ name: 'X', unit: 'пачка' }))).toBe('unit');
  });
});

describe('T-001 К5: обязательные поля', () => {
  it.each(['', '   '])('T-001 К5: название %j — отказ name', (name) => {
    expect(errorOf(createProduct({ name, unit: 'г' }))).toBe('name');
  });

  it('T-001 К5: нет единицы (не передана) — отказ unit', () => {
    expect(errorOf(createProduct({ name: 'X' }))).toBe('unit');
  });

  it('T-001 К5: единица null — отказ unit', () => {
    expect(errorOf(createProduct({ name: 'X', unit: null }))).toBe('unit');
  });
});

describe('T-001 К6: упаковка и коэффициент парой', () => {
  it('T-001 К6: упаковка без коэффициента — отказ pack', () => {
    expect(errorOf(createProduct({ name: 'X', unit: 'г', packName: 'пачка' }))).toBe('pack');
  });

  it('T-001 К6: коэффициент без упаковки — отказ pack', () => {
    expect(errorOf(createProduct({ name: 'X', unit: 'г', packSize: 250 }))).toBe('pack');
  });
});

describe('T-001 К7: недопустимые количества', () => {
  it.each([0, -1])('T-001 К7: коэффициент %d — отказ pack_size', (packSize) => {
    expect(errorOf(createProduct({ name: 'X', unit: 'г', packName: 'п', packSize }))).toBe('pack_size');
  });

  it('T-001 К7: норма 0 — отказ norm', () => {
    expect(errorOf(createProduct({ name: 'X', unit: 'г', normAmount: 0, normPeriod: DAY }))).toBe('norm');
  });

  it('T-001 К7: порция 0 — отказ portion', () => {
    expect(errorOf(createProduct({ name: 'X', unit: 'г', portion: 0 }))).toBe('portion');
  });

  it('T-001 К7: нижний порог −1 — отказ low_threshold', () => {
    expect(errorOf(createProduct({ name: 'X', unit: 'г', lowThreshold: -1 }))).toBe('low_threshold');
  });

  it('T-001 К7: нижний порог 0 допустим', () => {
    expect(value(createProduct({ name: 'X', unit: 'г', lowThreshold: 0 })).lowThresholdMilli).toBe(0);
  });
});

describe('T-001 К8: недельная норма в суточную', () => {
  it('T-001 К8: 250 г за неделю — 35714, введённая сохраняется', () => {
    const p = value(createProduct({ name: 'Кофе молотый', unit: 'г', normAmount: 250, normPeriod: WEEK }));
    expect(p.norm).toEqual(norm(35714, 250000, WEEK));
  });

  it('T-001 К8: dailyNormMilli(250000, неделя) = 35714', () => {
    expect(dailyNormMilli(250000, WEEK)).toBe(35714);
  });
});

describe('T-001 К9: норма за N дней', () => {
  it('T-001 К9: 1000 мл за 2 дня — 500000, введённая сохраняется', () => {
    const p = value(createProduct({ name: 'Молоко', unit: 'мл', normAmount: 1000, normPeriod: days(2) }));
    expect(p.norm).toEqual(norm(500000, 1000000, days(2)));
  });
});

describe('T-001 К10: одно округление, половина от нуля', () => {
  it('T-001 К10: 0,003 г за 2 дня — 2', () => {
    const p = value(createProduct({ name: 'X', unit: 'г', normAmount: 0.003, normPeriod: days(2) }));
    expect(p.norm?.enteredMilli).toBe(3);
    expect(p.norm?.dailyMilli).toBe(2);
  });

  it('T-001 К10: 300 г за неделю — 42857', () => {
    const p = value(createProduct({ name: 'X', unit: 'г', normAmount: 300, normPeriod: WEEK }));
    expect(p.norm?.dailyMilli).toBe(42857);
  });

  it('T-001 К10: dailyNormMilli — целое, половина от нуля', () => {
    expect(dailyNormMilli(3, days(2))).toBe(2);
    expect(dailyNormMilli(300000, WEEK)).toBe(42857);
  });
});

describe('T-001 К11: норма за сутки не пересчитывается', () => {
  it('T-001 К11: 30 г за сутки — 30000, период «сутки»', () => {
    const p = value(createProduct({ name: 'X', unit: 'г', normAmount: 30, normPeriod: DAY }));
    expect(p.norm).toEqual(norm(30000, 30000, DAY));
    expect(dailyNormMilli(30000, DAY)).toBe(30000);
  });
});

describe('T-001 К12: недопустимый период', () => {
  const base = { name: 'X', unit: 'г' };

  it('T-001 К12: норма без периода (не передан) — norm_period', () => {
    expect(errorOf(createProduct({ ...base, normAmount: 250 }))).toBe('norm_period');
  });

  it('T-001 К12: норма с периодом null — norm_period', () => {
    expect(errorOf(createProduct({ ...base, normAmount: 250, normPeriod: null }))).toBe('norm_period');
  });

  it.each([0, -1, 1.5])('T-001 К12: период «N дней», N = %s — norm_period', (n) => {
    expect(errorOf(createProduct({ ...base, normAmount: 250, normPeriod: days(n) }))).toBe('norm_period');
  });

  it('T-001 К12: период без нормы — norm_period', () => {
    expect(errorOf(createProduct({ ...base, normPeriod: WEEK }))).toBe('norm_period');
  });
});

describe('T-001 К13: суточная норма округлилась до нуля', () => {
  it('T-001 К13: 0,001 г за неделю — отказ norm', () => {
    expect(errorOf(createProduct({ name: 'X', unit: 'г', normAmount: 0.001, normPeriod: WEEK }))).toBe('norm');
  });
});

describe('T-001 К14: две позиции «кофе» (BR-05)', () => {
  it('T-001 К14: правка нормы одной не трогает другую; у каждой своя порция', () => {
    const grams = value(createProduct({ name: 'Кофе', unit: 'г', normAmount: 30, normPeriod: DAY }));
    const pieces = value(createProduct({ name: 'Кофе', unit: 'шт', normAmount: 2, normPeriod: DAY }));

    const grams2 = value(editProduct(grams, { normAmount: 40, normPeriod: DAY }));

    expect(grams2.unit).toBe('г');
    expect(grams2.norm?.dailyMilli).toBe(40000);
    expect(pieces.unit).toBe('шт');
    expect(pieces.norm?.dailyMilli).toBe(2000);
    expect(effectivePortion(grams2)).toBe(40000);
    expect(effectivePortion(pieces)).toBe(2000);
  });
});
