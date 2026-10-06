// T-001, К15–К18: пересчёт упаковок в расходную единицу. BR-03, BR-04.
import { describe, expect, it } from 'vitest';
import { convertPacks } from '../../src/domain/catalog.ts';
import { packsToMilli, toMilli } from '../../src/domain/quantity.ts';
import { errorOf, product, value } from '../support/products.ts';

describe('T-001 К15: целые упаковки', () => {
  it('T-001 К15: 2 пачки по 250 г — 500000', () => {
    const p = product({ pack: { name: 'пачка', sizeMilli: 250000 } });
    expect(value(convertPacks(p, 2))).toBe(500000);
  });
});

describe('T-001 К16: другой размер упаковки — та же позиция (BR-04)', () => {
  const milk = product({ name: 'Молоко', unit: 'мл', pack: { name: 'бутылка 1 л', sizeMilli: 1000000 } });

  it('T-001 К16: 0,5 упаковки — 500000', () => {
    expect(value(convertPacks(milk, 0.5))).toBe(500000);
  });

  it('T-001 К16: 500 мл прямым вводом — 500000', () => {
    expect(toMilli(500)).toBe(500000);
  });

  it('T-001 К16: коэффициент позиции не меняется пересчётом', () => {
    convertPacks(milk, 0.5);
    expect(milk.pack?.sizeMilli).toBe(1000000);
  });
});

describe('T-001 К17: округление ввода до тысячной', () => {
  const box = product({ unit: 'шт', pack: { name: 'коробка', sizeMilli: 10000 } });

  it('T-001 К17: 1/3 коробки по 10 шт — 3333', () => {
    expect(value(convertPacks(box, 1 / 3))).toBe(3333);
    expect(packsToMilli(1 / 3, 10000)).toBe(3333);
  });

  it('T-001 К17: 1,5 шт — 1500', () => {
    expect(toMilli(1.5)).toBe(1500);
  });

  it('T-001 К17: 0,0005 шт — 1 (половина от нуля)', () => {
    expect(toMilli(0.0005)).toBe(1);
  });
});

describe('T-001 К18: пересчёт без коэффициента', () => {
  it('T-001 К18: у позиции нет упаковки — отказ no_pack', () => {
    expect(errorOf(convertPacks(product(), 1))).toBe('no_pack');
  });
});
