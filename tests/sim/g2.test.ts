import { describe, expect, it } from 'vitest';
import { correctList, g2Period, g2Week, type Need } from './g2.ts';

const need = (productId: string, unitsNeeded: number, unitsPerPack = 100, dailyUnits = 40): Need => ({ productId, unitsNeeded, unitsPerPack, dailyUnits });
const status = (r: ReturnType<typeof correctList>) => Object.fromEntries(r.map((i) => [i.productId, i.status]));

describe('T-007 К13: G-2 и правило симулируемого пользователя (Q-32)', () => {
  const list = [{ productId: 'A', packs: 1 }, { productId: 'B', packs: 2 }, { productId: 'C', packs: 1 }];
  const needs = [need('A', 80), need('B', 0), need('C', 300), need('D', 100)];

  it('T-007 К13: B вычеркнута, C изменена, D добавлена, A без правки; итоговый список A, B, C, D', () => {
    const final = correctList(list, needs);
    expect(final.map((f) => f.productId)).toEqual(['A', 'B', 'C', 'D']);
    expect(status(final)).toEqual({ A: 'untouched', B: 'struck', C: 'changed', D: 'added' });
    expect(final.find((f) => f.productId === 'C')?.packs).toBe(3);
    expect(final.find((f) => f.productId === 'D')?.packs).toBe(1);
  });

  it('T-007 К13: доля 3 / 4 = 75% (вычеркнутая остаётся в знаменателе)', () => {
    const w = g2Week(correctList(list, needs));
    expect([w.corrected, w.total, w.share]).toEqual([3, 4, 0.75]);
  });

  it('T-007 К13: «перебор» — 3 уп при нужных 700 г (лишнее 800 > 700) исправлено; 2 уп при 900 г (лишнее 100) — нет', () => {
    const E = (units: number) => [need('E', units, 500, 100)];
    expect(status(correctList([{ productId: 'E', packs: 3 }], E(700)))).toEqual({ E: 'changed' });
    expect(status(correctList([{ productId: 'E', packs: 2 }], E(900)))).toEqual({ E: 'untouched' });
  });

  it('T-007 К13: граница перебора — лишнее ровно 700 не исправляется, 701 исправляется', () => {
    const E = (units: number) => [need('E', units, 500, 100)];
    expect(status(correctList([{ productId: 'E', packs: 3 }], E(800)))).toEqual({ E: 'untouched' });
    expect(status(correctList([{ productId: 'E', packs: 3 }], E(799)))).toEqual({ E: 'changed' });
  });

  it('T-007 К13: нехватка ровно в 1 единицу — количество изменено; ровно хватает — без правки', () => {
    expect(status(correctList([{ productId: 'A', packs: 1 }], [need('A', 101)]))).toEqual({ A: 'changed' });
    expect(status(correctList([{ productId: 'A', packs: 1 }], [need('A', 100)]))).toEqual({ A: 'untouched' });
  });

  it('T-007 К13: пустой список и ничего не нужно — null, а не 0', () => {
    expect(g2Week(correctList([], [need('A', 0)])).share).toBeNull();
    expect(g2Week(correctList([], [])).share).toBeNull();
    expect(g2Period([])).toBeNull();
  });

  it('T-007 К13: за период — обучающие 8 недель не входят ни в числитель, ни в знаменатель', () => {
    const weeks = [
      ...Array.from({ length: 8 }, () => ({ corrected: 10, total: 10 })),
      { corrected: 1, total: 10 },
      { corrected: 3, total: 10 },
    ];
    expect(g2Period(weeks)).toBeCloseTo(0.2, 10);
    expect(g2Period(weeks.slice(0, 8))).toBeNull();
    expect(g2Period(weeks.slice(0, 9))).toBeCloseTo(0.1, 10);
  });
});
