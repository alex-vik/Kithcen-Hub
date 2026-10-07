import { isInstant } from '../../src/domain/time.ts';
import { describe, expect, it } from 'vitest';
import { addDays, localDateOf, localDates, localToInstant } from './local-time.ts';
import { nth } from './util.ts';

describe('T-006 К4: местное время Europe/Vilnius', () => {
  it.each([
    ['2026-03-28', '2026-03-28T06:00:00.000Z'],
    ['2026-03-29', '2026-03-29T05:00:00.000Z'],
    ['2026-10-24', '2026-10-24T05:00:00.000Z'],
    ['2026-10-25', '2026-10-25T06:00:00.000Z'],
  ])('T-006 К4: %s 08:00 -> %s', (date, utc) => {
    expect(localToInstant(date, '08:00')).toBe(utc);
  });

  it('T-006 К4: ночь перед переходом и после (границы DST)', () => {
    expect(localToInstant('2026-03-29', '02:59')).toBe('2026-03-29T00:59:00.000Z'); // ещё зимнее
    expect(localToInstant('2026-03-29', '04:00')).toBe('2026-03-29T01:00:00.000Z'); // уже летнее
    expect(localToInstant('2026-10-25', '04:00')).toBe('2026-10-25T02:00:00.000Z'); // уже зимнее
    expect(localToInstant('2026-10-25', '02:59')).toBe('2026-10-24T23:59:00.000Z'); // ещё летнее
  });

  it('T-006 К4: 365 суток с 2026-01-03 — 365 разных дат, последняя 2027-01-02, все Instant', () => {
    const dates = localDates('2026-01-03', 365);
    expect(dates).toHaveLength(365);
    expect(new Set(dates).size).toBe(365);
    expect(nth(dates, 0)).toBe('2026-01-03');
    expect(nth(dates, -1)).toBe('2027-01-02');
    const instants = dates.map((d) => localToInstant(d, '08:00'));
    expect(instants.every(isInstant)).toBe(true);
    // обратный перевод возвращает ту же дату: ни потерянных, ни лишних суток
    expect(instants.map(localDateOf)).toEqual(dates);
    expect(new Set(instants.map((i) => localDateOf(i))).size).toBe(365);
  });

  it('T-006 К4: сутки 23, 24 или 25 часов; 23 — 2026-03-29, 25 — 2026-10-25', () => {
    const len = (d: string): number =>
      (Date.parse(localToInstant(addDays(d, 1), '00:00')) - Date.parse(localToInstant(d, '00:00'))) / 3_600_000;
    expect(len('2026-03-29')).toBe(23);
    expect(len('2026-10-25')).toBe(25);
    const odd = localDates('2026-01-03', 365).filter((d) => len(d) !== 24);
    expect(odd).toEqual(['2026-03-29', '2026-10-25']);
  });

  it('T-006 К4: localDateOf на границе местной полуночи', () => {
    expect(localDateOf('2026-01-03T21:59:59.000Z')).toBe('2026-01-03');
    expect(localDateOf('2026-01-03T22:00:00.000Z')).toBe('2026-01-04');
    expect(localDateOf('2026-07-01T20:59:59.000Z')).toBe('2026-07-01');
    expect(localDateOf('2026-07-01T21:00:00.000Z')).toBe('2026-07-02');
  });
});
