import { describe, expect, it } from 'vitest';
import { addDays, localToInstant } from './local-time.ts';
import { neverBuysPolicy } from './policies.ts';
import { manualProduct, usedOn } from './helpers.ts';
import { runScenario } from './run.ts';
import { nth } from './util.ts';

const START = '2026-01-05';
const coffee = manualProduct('coffee', 250, { kind: 'rhythmic', dailyUnits: 40, slotHours: [8] });
const facts = Array.from({ length: 8 }, (_, d) => usedOn('coffee', START, d, '08:00', 40));
const buyOnce = { label: 'ручная', decide: () => [{ productId: 'coffee', packs: 1 }] };
const run = () =>
  runScenario({ profile: { products: [coffee] }, policy: buyOnce, startDate: START, days: 8, facts, schedule: [localToInstant(START, '06:00')] });

describe('T-007 К7: реальный остаток и неудовлетворённый спрос', () => {
  it('T-007 К7: сутки 0–5 спрос удовлетворён, остаток после суток 5 — 10', () => {
    const r = run();
    for (let d = 0; d <= 5; d++) {
      const p = nth(r.daily, d).products['coffee']!;
      expect(p.served, `сутки ${d}`).toBe(40);
      expect(p.unmet, `сутки ${d}`).toBe(0);
    }
    expect(nth(r.daily, 5).products['coffee']!.realEnd).toBe(10);
  });

  it('T-007 К7: сутки 6 — съедено 10, неудовлетворено 30, остаток 0; сутки 7 — неудовлетворено 40', () => {
    const r = run();
    expect(nth(r.daily, 6).products['coffee']).toMatchObject({ served: 10, unmet: 30, realEnd: 0 });
    expect(nth(r.daily, 7).products['coffee']).toMatchObject({ served: 0, unmet: 40, realEnd: 0 });
    expect(r.unmet.map((u) => [u.at, u.quantity])).toEqual([
      [localToInstant(addDays(START, 6), '08:00'), 30],
      [localToInstant(addDays(START, 7), '08:00'), 40],
    ]);
  });

  it('T-007 К7: реальный остаток ни в какой момент не отрицателен', () => {
    const r = run();
    expect(r.minRealStock).toBeGreaterThanOrEqual(0);
    for (const d of r.daily) expect(d.products['coffee']!.realEnd).toBeGreaterThanOrEqual(0);
  });

  it('T-007 К7: без закупок весь спрос неудовлетворён, остаток 0 (FR-CAT-07: старт с нуля)', () => {
    const r = runScenario({ profile: { products: [coffee] }, policy: neverBuysPolicy, startDate: START, days: 8, facts, schedule: [] });
    expect(r.daily.every((d) => d.products['coffee']!.served === 0 && d.products['coffee']!.unmet === 40)).toBe(true);
    expect(r.events).toEqual([]);
  });

  it('T-007 К7: закупка и расход в один и тот же момент — закупка раньше', () => {
    const r = runScenario({ profile: { products: [coffee] }, policy: buyOnce, startDate: START, days: 1, facts: [usedOn('coffee', START, 0, '08:00', 40)], schedule: [localToInstant(START, '08:00')] });
    expect(nth(r.daily, 0).products['coffee']).toMatchObject({ served: 40, unmet: 0, realEnd: 210 });
  });

  it('T-007 К7: позиция, которую домен отвергает, останавливает прогон (createProduct)', () => {
    const bad = manualProduct('bad', 0, { kind: 'rhythmic', dailyUnits: 1, slotHours: [8] });
    expect(() => runScenario({ profile: { products: [bad] }, policy: neverBuysPolicy, startDate: START, days: 1, facts: [] })).toThrow(/createProduct/);
  });
});
