import { describe, expect, it } from 'vitest';
import { computeG1 } from './g1.ts';
import { localDates, localToInstant } from './local-time.ts';
import { neverBuysPolicy, oraclePolicy, type PolicyContext, type PurchasePolicy } from './policies.ts';
import { manualProduct, usedOn } from './helpers.ts';
import { purchaseSchedule, runScenario } from './run.ts';
import { nth } from './util.ts';

const START = '2026-01-03'; // суббота
const DAYS = 28;
const daily = manualProduct('daily', 300, { kind: 'rhythmic', dailyUnits: 40, slotHours: [12] });
const burst = manualProduct('burst', 500, { kind: 'burst', usesPerWeek: 7 / 3, unitsPerUse: 150 });
const profile = { products: [daily, burst] };
const facts = [
  ...Array.from({ length: DAYS }, (_, d) => usedOn('daily', START, d, '12:00', 40)),
  ...Array.from({ length: Math.ceil(DAYS / 3) }, (_, i) => usedOn('burst', START, i * 3, '12:00', 150)),
];
const schedule = purchaseSchedule(START, DAYS, false);
const run = (policy: PurchasePolicy) => runScenario({ profile, policy, startDate: START, days: DAYS, facts, schedule });
const g1 = (r: ReturnType<typeof run>) => computeG1({ unmet: r.unmet, purchases: r.purchases, startDate: START, days: DAYS });

describe('T-007 К11: эталонные политики закупки', () => {
  it('T-007 К11: расписание — субботы 11:00 местного, прогон стартует в субботу', () => {
    expect(schedule).toEqual([0, 7, 14, 21].map((d) => localToInstant(nth(localDates(START, DAYS), d), '11:00')));
  });

  it('T-007 К11: оракул покупает целые упаковки >= 1 в дни закупки, G-1 = 0', () => {
    const r = run(oraclePolicy);
    expect(r.purchases.length).toBeGreaterThan(0);
    for (const p of r.purchases) {
      expect(Number.isInteger(p.packs) && p.packs >= 1).toBe(true);
      expect(schedule).toContain(p.at);
    }
    expect(r.unmet).toEqual([]);
    expect(g1(r)).toMatchObject({ cases: 0, unmetProductDays: 0 });
  });

  it('T-007 К11: оракул не перекупает — остаток после последних суток меньше упаковки', () => {
    const r = run(oraclePolicy);
    const last = nth(r.daily, DAYS - 1).products;
    expect(last['daily']!.realEnd).toBeLessThan(300);
    expect(last['burst']!.realEnd).toBeLessThan(500);
  });

  it('T-007 К11: «не покупает» — G-1 = 2 (по эпизоду на позицию)', () => {
    const r = run(neverBuysPolicy);
    expect(r.purchases).toEqual([]);
    expect(g1(r).cases).toBe(2);
  });

  it('T-007 К11: интерфейс одинаков; оракул дополнительно получает реальность, остальные — нет', () => {
    const seen: PolicyContext[] = [];
    const spy = (p: PurchasePolicy): PurchasePolicy => ({ ...p, decide: (ctx) => (seen.push(ctx), p.decide(ctx)) });
    run(spy(oraclePolicy));
    const withReality = seen.length;
    run(spy(neverBuysPolicy));
    const ctxs = seen.slice(withReality);
    expect(withReality).toBe(schedule.length);
    expect(seen.slice(0, withReality).every((c) => c.reality !== undefined)).toBe(true);
    expect(ctxs.every((c) => c.reality === undefined)).toBe(true);
    expect(nth(ctxs, 0).at).toBe(nth(schedule, 0));
    expect(nth(ctxs, 0).nextAt).toBe(nth(schedule, 1));
    expect(nth(ctxs, 3).nextAt).toBe(localToInstant('2026-01-31', '00:00'));
    expect(nth(ctxs, 0).products.map((p) => p.id)).toEqual(['daily', 'burst']);
  });

  it('T-007 К11: знания системы в контексте — срез по журналу (идеальный пользователь: равны реальному остатку)', () => {
    const pairs: [number, number][] = [];
    run({
      ...oraclePolicy,
      decide: (ctx) => {
        pairs.push([ctx.known('daily'), ctx.reality?.stock('daily') ?? NaN]);
        return oraclePolicy.decide(ctx);
      },
    });
    expect(pairs.length).toBe(schedule.length);
    expect(pairs.every(([k, r]) => k === r)).toBe(true);
    expect(pairs.some(([k]) => k > 0)).toBe(true);
  });
});
