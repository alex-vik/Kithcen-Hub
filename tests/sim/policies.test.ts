import { describe, expect, it } from 'vitest';
import { computeG1 } from './g1.ts';
import { localDates, localToInstant } from './local-time.ts';
import { systemBalanceAt } from './known.ts';
import { idealUser, type MarkModel } from './marks.ts';
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
const g1 = (r: ReturnType<typeof run>) => computeG1({ unmet: r.unmet, schedule: r.schedule, startDate: START, days: DAYS });

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

  it('T-007 К11 (Q-31 уточн.): «не покупает» — G-1 = 8: эпизод кончается каждой плановой закупкой, по 4 на позицию', () => {
    const r = run(neverBuysPolicy);
    expect(r.purchases).toEqual([]);
    expect(g1(r).cases).toBe(8);
    for (const id of ['daily', 'burst']) {
      const own = r.unmet.filter((x) => x.productId === id);
      expect(computeG1({ unmet: own, schedule: r.schedule, startDate: START, days: DAYS }).cases, id).toBe(4);
    }
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

describe('T-007 К11: знания системы в политике — срез журнала, а не реальность', () => {
  const lossy: MarkModel = {
    name: 'теряет потребление',
    marks: (e) => (e.type === 'purchase' ? idealUser.marks(e) : []),
  };
  const lateBuy: MarkModel = {
    name: 'покупку не отметил',
    marks: (e) => (e.type === 'consumption' ? idealUser.marks(e) : []),
  };
  const one = { products: [daily] };
  const oneFacts = facts.filter((f) => f.productId === 'daily');
  for (const [name, marks] of [['потеря потребления', lossy], ['покупка не отмечена', lateBuy]] as const) {
    it(`T-007 К11: ${name} — ctx.known == systemBalanceAt(журнал, at) и не равен реальному остатку`, () => {
      const seen: { at: string; known: number; real: number }[] = [];
      const spy: PurchasePolicy = {
        ...oraclePolicy,
        decide: (ctx) => (seen.push({ at: ctx.at, known: ctx.known('daily'), real: ctx.reality?.stock('daily') ?? NaN }), oraclePolicy.decide(ctx)),
      };
      const r = runScenario({ profile: one, policy: spy, marks, startDate: START, days: DAYS, facts: oneFacts, schedule });
      expect(seen.length).toBe(schedule.length);
      for (const s of seen) expect(s.known, s.at).toBe(systemBalanceAt(r.events.filter((e) => e.recordedAt < s.at), s.at)); // события того же момента пишутся после решения
      expect(seen.some((s) => s.known !== s.real)).toBe(true);
    });
  }
});

describe('T-007 К11: окно спроса оракула — [закупка, следующая закупка)', () => {
  it('T-007 К11: факт ровно в момент закупки входит в окно, ровно в момент следующей — нет', () => {
    const t0 = localToInstant('2026-01-03', '11:00');
    const t1 = localToInstant('2026-01-10', '11:00');
    const p = manualProduct('x', 100, { kind: 'burst', usesPerWeek: 1, unitsPerUse: 100 });
    const fact = (at: string) => ({ productId: 'x', at, quantity: 100 });
    const r = runScenario({ profile: { products: [p] }, policy: oraclePolicy, startDate: '2026-01-03', days: 14, facts: [fact(t0), fact(t1)], schedule: [t0, t1] });
    expect(r.purchases.map((x) => x.packs)).toEqual([1, 1]);
    expect(r.unmet).toEqual([]);
  });
});
