import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, PERIOD_DAYS, PERIOD_START } from './config.ts';
import { idealUser, type MarkModel } from './marks.ts';
import { oraclePolicy } from './policies.ts';
import { TEMP_PROFILE } from './profile.ts';
import { buildReport, runScenario } from './run.ts';

const go = (seed = DEFAULT_SEED, marks?: MarkModel) =>
  runScenario({ profile: TEMP_PROFILE, policy: oraclePolicy, seed, startDate: PERIOD_START, days: PERIOD_DAYS, ...(marks ? { marks } : {}) });

const first = go();
const report = buildReport(first);

describe('T-007 К10: расхождение остатка у идеального пользователя — ноль', () => {
  it('T-007 К10: во всех точках (позиция × сутки) расхождение ровно 0', () => {
    expect(first.divergence.length).toBe(PERIOD_DAYS * TEMP_PROFILE.products.length);
    expect(first.divergence.filter((d) => d.diff !== 0)).toEqual([]);
    expect(first.daily.length).toBe(PERIOD_DAYS);
  });

  it('T-007 К10: самопроверка — потеря отметок расхождение обнаруживает', () => {
    const lossy: MarkModel = {
      name: 'теряет молоко',
      marks: (e) => (e.productId === 'milk' && e.type === 'consumption' ? [] : idealUser.marks(e)),
    };
    const r = buildReport(go(DEFAULT_SEED, lossy));
    expect(r.maxDivergence).toBeGreaterThan(0);
  });

  it('T-007 К10: id событий уникальны за весь прогон (BR-26)', () => {
    expect(new Set(first.events.map((e) => e.id)).size).toBe(first.events.length);
  });

  it('T-007 К10: реальный остаток не отрицателен, у оракула нет неудовлетворённого спроса', () => {
    expect(first.minRealStock).toBeGreaterThanOrEqual(0);
    expect(first.unmet).toEqual([]);
  });
});

describe('T-007 К14: отчёт сценария «идеальный пользователь»', () => {
  it('T-007 К14: поля и пометки заглушек — данные отчёта', () => {
    expect(report).toMatchObject({
      scenario: 'идеальный пользователь',
      seed: DEFAULT_SEED,
      period: { startDate: PERIOD_START, days: PERIOD_DAYS },
      profile: 'временный (Q-19)',
      metricsStatus: 'предварительно (Q-19)',
      reality: 'без календаря гостей и отъездов (до B-05)',
      policy: 'оракул (заглушка до B-11)',
      initialPurchase: 'начальная закупка 00:00 сутки 0 (стенд)',
      maxDivergence: 0,
      g2: { value: null, note: 'нет списка покупок до B-11' },
      calibrationQuestionsPerWeek: { value: null, note: 'нет калибровки до B-13' },
    });
  });

  it('T-007 К14: G-1 — случаев 0, в месяц 0, худшее окно 0, позиция-суток 0', () => {
    expect(report.g1).toEqual({ cases: 0, perMonth: 0, worst90: 0, unmetProductDays: 0 });
  });

  it('T-007 К14: число событий по видам — только purchase, portion, depleted; сумма = длине журнала', () => {
    const kinds = Object.keys(report.eventCounts).sort();
    expect(kinds).toEqual(['depleted', 'portion', 'purchase']);
    expect(Object.values(report.eventCounts).reduce((a, b) => a + b, 0)).toBe(first.events.length);
    expect(report.eventCounts['portion']).toBeGreaterThan(1000);
    expect(report.eventCounts['purchase']).toBeGreaterThan(100);
  });
});

describe('T-007 К15: прогон воспроизводим', () => {
  it('T-007 К15: один сид — равные отчёты и журналы (id, seq, моменты); другой сид — другой журнал', () => {
    const again = go();
    const other = go(DEFAULT_SEED + 1);
    expect(again.events).toEqual(first.events);
    expect(buildReport(again)).toEqual(report);
    expect(other.events).not.toEqual(first.events);
    expect(other.seed).toBe(DEFAULT_SEED + 1);
  });
});
