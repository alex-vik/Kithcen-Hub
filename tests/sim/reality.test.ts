import { describe, expect, it } from 'vitest';
import { isInstant } from '../../src/domain/time.ts';
import { DEFAULT_SEED, PERIOD_DAYS, PERIOD_START, TOLERANCE } from './config.ts';
import { addDays, localDateOf, localDates, localToInstant } from './local-time.ts';
import { TEMP_PROFILE, type HomeProfile } from './profile.ts';
import { generateReality } from './reality.ts';

const opts = { seed: DEFAULT_SEED, startDate: PERIOD_START, days: PERIOD_DAYS };
const reality = generateReality(TEMP_PROFILE, opts);
const dates = localDates(PERIOD_START, PERIOD_DAYS);
const weeks = PERIOD_DAYS / 7;
const within = (actual: number, expected: number, tol: number): boolean => Math.abs(actual - expected) <= expected * tol;

describe('T-006 К5: реальность воспроизводима', () => {
  it('T-006 К5: один сид — строго равные результаты, другой сид — другой', () => {
    const again = generateReality(TEMP_PROFILE, opts);
    const other = generateReality(TEMP_PROFILE, { ...opts, seed: DEFAULT_SEED + 1 });
    expect(reality.length).toBeGreaterThan(1000);
    expect(again).toEqual(reality);
    expect(generateReality(TEMP_PROFILE)).toEqual(reality); // сид, начало и длина по умолчанию = параметры стенда
    expect(other).not.toEqual(reality);
  });
});

describe('T-006 К6: реальность соответствует профилю', () => {
  it('T-006 К6: моменты внутри периода и канонические; количества — целые >= 1; все позиции профиля', () => {
    const from = localToInstant(PERIOD_START, '00:00');
    const to = localToInstant(addDays(PERIOD_START, PERIOD_DAYS), '00:00');
    for (const f of reality) {
      expect(isInstant(f.at)).toBe(true);
      expect(f.at >= from && f.at < to).toBe(true);
      expect(Number.isInteger(f.quantity) && f.quantity >= 1).toBe(true);
    }
    const ids = new Set(reality.map((f) => f.productId));
    expect([...ids].sort()).toEqual(TEMP_PROFILE.products.map((p) => p.input.id).sort());
  });

  it('T-006 К6: факты упорядочены по времени', () => {
    for (let i = 1; i < reality.length; i++) expect(reality[i - 1]!.at <= reality[i]!.at).toBe(true);
  });

  for (const { input, usage } of TEMP_PROFILE.products) {
    const mine = reality.filter((f) => f.productId === input.id);
    const total = mine.reduce((s, f) => s + f.quantity, 0);
    if (usage.kind === 'rhythmic') {
      it(`T-006 К6: ритмичная ${input.id} — расход каждые сутки, сумма в ±10%`, () => {
        const days = new Set(mine.map((f) => localDateOf(f.at)));
        expect(dates.filter((d) => !days.has(d))).toEqual([]);
        expect(within(total, usage.dailyUnits * PERIOD_DAYS, TOLERANCE.rhythmic), `${total}`).toBe(true);
      });
    } else if (usage.kind === 'burst') {
      it(`T-006 К6: рывковая ${input.id} — число использований в ±25%`, () => {
        expect(within(mine.length, usage.usesPerWeek * weeks, TOLERANCE.burst), `${mine.length}`).toBe(true);
      });
    } else {
      it(`T-006 К6: медленная ${input.id} — суммарный расход в ±25%`, () => {
        const expected = (input.unitsPerPack / usage.packLifeDays) * PERIOD_DAYS;
        expect(within(total, expected, TOLERANCE.slow), `${total} vs ${expected}`).toBe(true);
      });
    }
  }

  it('T-006 К6: ни одно использование рывковой и медленной позиции не пропущено при любом сиде (число использований > 0)', () => {
    for (const { input, usage } of TEMP_PROFILE.products) {
      if (usage.kind !== 'rhythmic') expect(reality.some((f) => f.productId === input.id), input.id).toBe(true);
    }
  });

  it('T-006 К6: календарь гостей и отъездов не меняет реальность при том же сиде (НВ-3)', () => {
    const changed: HomeProfile = {
      ...TEMP_PROFILE,
      calendar: {
        guests: { fourPeoplePerMonth: 8, sixPeoplePerMonths: 1, multiDayShare: 1 },
        trips: { shortPerYear: 12, shortDays: [10, 20], vacationPerYear: 4, vacationDays: 60 },
      },
    };
    expect(changed.calendar).not.toEqual(TEMP_PROFILE.calendar);
    expect(generateReality(changed, opts)).toEqual(reality);
  });

  it('T-006 К6: корм собаки расходуется и в дни переходов DST', () => {
    const dogDays = new Set(reality.filter((f) => f.productId === 'dog-food').map((f) => localDateOf(f.at)));
    expect(dogDays.has('2026-03-29')).toBe(true);
    expect(dogDays.has('2026-10-25')).toBe(true);
    expect(dogDays.size).toBe(PERIOD_DAYS);
  });
});
