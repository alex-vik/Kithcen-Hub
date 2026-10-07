import { describe, expect, it } from 'vitest';
import { isInstant } from '../../src/domain/time.ts';
import { addDays, localToInstant } from './local-time.ts';
import { manualProduct, usedOn } from './helpers.ts';
import type { MarkModel } from './marks.ts';
import { runScenario } from './run.ts';
import { nth } from './util.ts';

const START = '2026-01-05';
const coffee = manualProduct('coffee', 250, { kind: 'rhythmic', dailyUnits: 40, slotHours: [8] });
const facts = Array.from({ length: 8 }, (_, d) => usedOn('coffee', START, d, '08:00', 40));
const buyOnce = { label: 'ручная', decide: () => [{ productId: 'coffee', packs: 1 }] };
const base = { profile: { products: [coffee] }, policy: buyOnce, startDate: START, days: 8, facts, schedule: [localToInstant(START, '06:00')] };

describe('T-007 К8: идеальный пользователь отмечает всё', () => {
  it('T-007 К8: покупка — purchase packs 1, unitsPerPack 250; потребление — portion на съеденное (сутки 6 — 10); depleted при нуле', () => {
    const ev = runScenario(base).events;
    expect(ev.map((e) => [e.kind, e.quantity, e.occurredAt])).toEqual([
      ['purchase', 250, localToInstant(START, '06:00')],
      ...[0, 1, 2, 3, 4, 5].map((d) => ['portion', 40, localToInstant(addDays(START, d), '08:00')]),
      ['portion', 10, localToInstant(addDays(START, 6), '08:00')],
      ['depleted', undefined, localToInstant(addDays(START, 6), '08:00')],
    ]);
    expect(nth(ev, 0)).toMatchObject({ packs: 1, unitsPerPack: 250 });
  });

  it('T-007 К8: неудовлетворённый спрос (сутки 7) событий не порождает', () => {
    const ev = runScenario(base).events;
    const day7 = localToInstant(addDays(START, 7), '00:00');
    expect(ev.filter((e) => e.occurredAt >= day7)).toEqual([]);
  });

  it('T-007 К8: occurredAt = recordedAt, seq строго растёт, id уникальны и совпадают при повторе', () => {
    const a = runScenario(base).events;
    const b = runScenario(base).events;
    expect(a.every((e) => e.occurredAt === e.recordedAt && isInstant(e.occurredAt))).toBe(true);
    for (let i = 1; i < a.length; i++) expect(nth(a, i).seq).toBeGreaterThan(nth(a, i - 1).seq);
    expect(new Set(a.map((e) => e.id)).size).toBe(a.length);
    expect(a.map((e) => [e.id, e.seq])).toEqual(b.map((e) => [e.id, e.seq]));
  });

  it('T-007 К8: отказ createStockEvent останавливает прогон с указанием события (Р2)', () => {
    const badModel: MarkModel = {
      name: 'сломанная',
      marks: (e) => (e.type === 'consumption' ? [{ productId: e.productId, kind: 'portion', quantity: 0, occurredAt: e.at, recordedAt: e.at }] : []),
    };
    expect(() => runScenario({ ...base, marks: badModel })).toThrow(/createStockEvent.*portion/);
    const fractional = { label: 'дробная', decide: () => [{ productId: 'coffee', packs: 1.5 }] };
    expect(() => runScenario({ ...base, policy: fractional })).toThrow(/createStockEvent/);
  });

  it('T-007 К8: отрицательный расчётный остаток системы не обрезается (BR-15)', () => {
    const lateBuy: MarkModel = {
      name: 'покупку не отметил',
      marks: (e) =>
        e.type === 'consumption' && e.eaten > 0
          ? [{ productId: e.productId, kind: 'portion', quantity: e.eaten, occurredAt: e.at, recordedAt: e.at }]
          : [],
    };
    const r = runScenario({ ...base, marks: lateBuy });
    expect(nth(r.daily, 0).products['coffee']!.knownEnd).toBe(-40);
    expect(nth(r.daily, 5).products['coffee']!.knownEnd).toBe(-240);
  });
});
