// T-010 Д1–Д6: сутки по Вильнюсу (BR-27, NFR-14, FR-CON-07, FR-CON-08).
import { describe, expect, it } from 'vitest';
import { isInstant } from '../../src/domain/time.ts';
import { addDays as simAddDays, localDateOf as simDateOf, localToInstant } from '../sim/local-time.ts';
import { nth } from '../server/storage/helpers.ts';
import { DEFAULTS, T, VILNIUS } from './auto-helpers.ts';

const BOUNDS: [string, string, string][] = [
  ['2026-10-07', '2026-10-06T21:00:00.000Z', '2026-10-07T21:00:00.000Z'],
  ['2026-03-29', '2026-03-28T22:00:00.000Z', '2026-03-29T21:00:00.000Z'],
  ['2026-10-25', '2026-10-24T21:00:00.000Z', '2026-10-25T22:00:00.000Z'],
  ['2026-12-31', '2026-12-30T22:00:00.000Z', '2026-12-31T22:00:00.000Z'],
];
const ms = (iso: string): number => Date.parse(iso);

describe('T-010 Д1: границы суток', () => {
  it.each(BOUNDS)('T-010 Д1: dayBounds(%s) = [%s, %s), оба — isInstant', (day, start, end) => {
    const b = T.dayBounds(day, VILNIUS);
    expect(b).toEqual({ start, end });
    expect(isInstant(b.start) && isInstant(b.end)).toBe(true);
  });

  it('T-010 Д1: длина суток 24, 23, 25 и 24 часа (сутки — не 24 ч)', () => {
    const hours = BOUNDS.map(([d]) => {
      const b = T.dayBounds(d, VILNIUS);
      return (ms(b.end) - ms(b.start)) / 3_600_000;
    });
    expect(hours).toEqual([24, 23, 25, 24]);
  });
});

describe('T-010 Д2: местная дата момента', () => {
  it.each(BOUNDS)('T-010 Д2: границы суток %s: «−1 мс» — предыдущие сутки, граница — эти', (day, start, end) => {
    expect(T.localDateOf(new Date(ms(start) - 1).toISOString(), VILNIUS)).toBe(T.addDays(day, -1));
    expect(T.localDateOf(start, VILNIUS)).toBe(day);
    expect(T.localDateOf(new Date(ms(end) - 1).toISOString(), VILNIUS)).toBe(day);
    expect(T.localDateOf(end, VILNIUS)).toBe(T.addDays(day, 1));
  });

  it('T-010 Д2: оба момента осеннего повтора (местные 03:30 до и после перевода) — 2026-10-25', () => {
    expect(T.localDateOf('2026-10-25T00:30:00.000Z', VILNIUS)).toBe('2026-10-25');
    expect(T.localDateOf('2026-10-25T01:30:00.000Z', VILNIUS)).toBe('2026-10-25');
  });
});

describe('T-010 Д3: addDays', () => {
  it.each([
    ['2026-03-28', 1, '2026-03-29'],
    ['2026-10-25', 1, '2026-10-26'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2028-03-01', -1, '2028-02-29'],
  ])('T-010 Д3: addDays(%s, %i) = %s', (d, n, want) => {
    expect(T.addDays(d, n)).toBe(want);
  });
});

describe('T-010 Д4: местное время суток и DST', () => {
  it.each([
    ['2026-10-07', '03:30', '2026-10-07T00:30:00.000Z'],
    ['2026-03-29', '03:30', '2026-03-29T01:00:00.000Z'],
    ['2026-03-29', '03:00', '2026-03-29T01:00:00.000Z'],
    ['2026-10-25', '03:30', '2026-10-25T00:30:00.000Z'],
    ['2026-10-25', '03:00', '2026-10-25T00:00:00.000Z'],
  ])('T-010 Д4: localTimeOn(%s, %s) = %s', (d, hhmm, want) => {
    expect(T.localTimeOn(d, hhmm, VILNIUS)).toBe(want);
  });

  it('T-010 Д4: localTimeOn(D, "00:00") = dayBounds(D).start для дат Д1', () => {
    for (const [d, start] of BOUNDS) {
      expect(T.localTimeOn(d, '00:00', VILNIUS)).toBe(start);
      expect(T.dayBounds(d, VILNIUS).start).toBe(start);
    }
  });
});

describe('T-010 Д5: сверка с независимым помощником симулятора (2026-01-01 … 2027-12-31)', () => {
  it('T-010 Д5: начало суток и 03:30 каждой даты совпадают с localToInstant', () => {
    let d = '2026-01-01';
    let n = 0;
    for (; d <= '2027-12-31'; d = simAddDays(d, 1), n++) {
      expect(T.dayBounds(d, VILNIUS).start, `start ${d}`).toBe(localToInstant(d, '00:00'));
      expect(T.localTimeOn(d, '03:30', VILNIUS), `03:30 ${d}`).toBe(localToInstant(d, '03:30'));
    }
    expect(n).toBe(730);
  });

  it('T-010 Д5: localDateOf совпадает с помощником для каждого часового момента периода', () => {
    const from = ms('2025-12-31T22:00:00.000Z');
    const to = ms('2027-12-31T22:00:00.000Z');
    let n = 0;
    for (let t = from; t <= to; t += 3_600_000, n++) {
      const iso = new Date(t).toISOString();
      if (T.localDateOf(iso, VILNIUS) !== simDateOf(iso)) expect(T.localDateOf(iso, VILNIUS), iso).toBe(simDateOf(iso));
    }
    expect(n).toBeGreaterThan(17_500);
  });
});

describe('T-010 Д6: pendingDays — завершённые необработанные сутки', () => {
  const p = (cursor: string, now: string, params = DEFAULTS) => T.pendingDays(cursor, now, params);

  it('T-010 Д6: за 1 мс до границы — пусто, на границе — сутки включены', () => {
    expect(p('2026-10-05', '2026-10-06T20:59:59.999Z')).toEqual([]);
    expect(p('2026-10-05', '2026-10-06T21:00:00.000Z')).toEqual(['2026-10-06']);
  });

  it('T-010 Д6: неделя простоя — семь дат по возрастанию', () => {
    expect(p('2026-09-30', '2026-10-07T21:00:00.000Z')).toEqual([
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
    ]);
  });

  it('T-010 Д6: весенний переход — пять дат, 2026-03-29 ровно один раз', () => {
    const r = p('2026-03-26', '2026-04-01T09:00:00.000Z');
    expect(r).toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
    expect(r.filter((d) => d === '2026-03-29')).toHaveLength(1);
  });

  it('T-010 Д6: осенний переход — пять дат, 2026-10-25 ровно один раз', () => {
    const r = p('2026-10-22', '2026-10-28T09:00:00.000Z');
    expect(r).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
    expect(r.filter((d) => d === '2026-10-25')).toHaveLength(1);
  });

  it('T-010 Д6: курсор на последних завершённых сутках или впереди now (часы назад) — пусто, без исключения', () => {
    expect(p('2026-10-06', '2026-10-06T21:00:00.000Z')).toEqual([]);
    expect(p('2026-10-20', '2026-10-07T21:00:00.000Z')).toEqual([]);
    expect(p('2026-10-07', '2026-10-07T21:00:00.000Z')).toEqual([]);
  });

  it('T-010 Д6: 03:30 — сутки 03-28 не завершены в 2026-03-29T00:59:59.999Z и завершены в 01:00:00.000Z', () => {
    const params = { ...DEFAULTS, autoWriteoffTime: '03:30' };
    expect(p('2026-03-27', '2026-03-29T00:59:59.999Z', params)).toEqual([]);
    expect(p('2026-03-27', '2026-03-29T01:00:00.000Z', params)).toEqual(['2026-03-28']);
  });

  it('T-010 Д6: 03:30 — сутки 10-24 завершены в 2026-10-25T00:30:00.000Z (первое вхождение), а не в 01:30', () => {
    const params = { ...DEFAULTS, autoWriteoffTime: '03:30' };
    expect(p('2026-10-23', '2026-10-25T00:29:59.999Z', params)).toEqual([]);
    expect(p('2026-10-23', '2026-10-25T00:30:00.000Z', params)).toEqual(['2026-10-24']);
    expect(nth(p('2026-10-23', '2026-10-25T01:30:00.000Z', params), 0)).toBe('2026-10-24');
  });
});
