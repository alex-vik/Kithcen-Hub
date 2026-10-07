import { describe, expect, it } from 'vitest';
import { isInstant } from '../../src/domain/time.ts';
import { DEFAULT_SEED, PERIOD_DAYS, PERIOD_START, TOLERANCE } from './config.ts';
import { addDays, localDateOf, localDates, localToInstant } from './local-time.ts';
import { TEMP_PROFILE, type HomeProfile, type SimProduct } from './profile.ts';
import { generateReality } from './reality.ts';
import { createRng, seedFor } from './rng.ts';
import { burstCountTolerance, slowSumTolerance } from './tolerance.ts';

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
      it(`T-006 К6: рывковая ${input.id} — число использований в пределах SIGMA_K·σ`, () => {
        const expected = usage.usesPerWeek * weeks;
        expect(Math.abs(mine.length - expected), `${mine.length} vs ${expected}`).toBeLessThanOrEqual(burstCountTolerance(usage));
      });
    } else {
      it(`T-006 К6: медленная ${input.id} — суммарный расход в пределах SIGMA_K·σ`, () => {
        const expected = (input.unitsPerPack / usage.packLifeDays) * PERIOD_DAYS;
        expect(Math.abs(total - expected), `${total} vs ${expected}`).toBeLessThanOrEqual(slowSumTolerance(expected, usage.packLifeDays));
      });
    }
  }

  it('T-006 К6: ни одно использование рывковой и медленной позиции не пропущено за период (число использований > 0) на сиде по умолчанию', () => {
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

describe('T-006 К5: независимость позиций и параметры вызова', () => {
  const factsOf = (facts: typeof reality, id: string) => facts.filter((f) => f.productId === id);
  const hourIn = (at: string): number =>
    Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vilnius', hour: '2-digit', hourCycle: 'h23' }).format(new Date(at)));

  it('T-006 К5: правка одной позиции профиля не меняет реальность остальных', () => {
    const edited: SimProduct[] = TEMP_PROFILE.products.map((p) =>
      p.input.id === 'milk' ? { ...p, usage: { kind: 'rhythmic', dailyUnits: 999, slotHours: [9, 21] } } : p,
    );
    const after = generateReality({ products: edited }, opts);
    expect(factsOf(after, 'milk')).not.toEqual(factsOf(reality, 'milk'));
    for (const { input } of TEMP_PROFILE.products) {
      if (input.id !== 'milk') expect(factsOf(after, input.id), input.id).toEqual(factsOf(reality, input.id));
    }
  });

  it('T-006 К5: удаление и перестановка позиций не меняют остальные', () => {
    const rest = TEMP_PROFILE.products.filter((p) => p.input.id !== 'tuna');
    const shuffled = generateReality({ products: [...rest].reverse() }, opts);
    for (const { input } of rest) expect(factsOf(shuffled, input.id), input.id).toEqual(factsOf(reality, input.id));
  });

  it('T-006 К5: сид позиции зависит от сида прогона и id; разные id — разные потоки', () => {
    expect(seedFor(1, 'milk')).toBe(seedFor(1, 'milk'));
    expect(seedFor(1, 'milk')).not.toBe(seedFor(2, 'milk'));
    expect(seedFor(1, 'milk')).not.toBe(seedFor(1, 'bread'));
    expect(createRng(seedFor(1, 'milk')).next()).not.toBe(createRng(seedFor(1, 'bread')).next());
  });

  it('T-006 К6: другой startDate и days — период и соответствие профилю соблюдены, вход — только products', () => {
    const startDate = '2026-03-20';
    const days = 28; // содержит весенний переход
    const facts = generateReality({ products: TEMP_PROFILE.products }, { seed: DEFAULT_SEED, startDate, days });
    const from = localToInstant(startDate, '00:00');
    const to = localToInstant(addDays(startDate, days), '00:00');
    expect(facts.length).toBeGreaterThan(100);
    expect(facts.every((f) => f.at >= from && f.at < to)).toBe(true);
    const dogDays = new Set(factsOf(facts, 'dog-food').map((f) => localDateOf(f.at)));
    expect([...dogDays].sort()).toEqual(localDates(startDate, days));
    const dogTotal = factsOf(facts, 'dog-food').reduce((s, f) => s + f.quantity, 0);
    expect(within(dogTotal, 90 * days, 0.1)).toBe(true);
    expect(generateReality({ products: TEMP_PROFILE.products }, { seed: DEFAULT_SEED, startDate, days })).toEqual(facts);
  });

  it('T-006 К6: ни один факт не в 03:00–03:59 местного (часы перехода DST)', () => {
    expect(reality.filter((f) => hourIn(f.at) === 3)).toEqual([]);
  });

  it('T-006 К6: часы слотов профиля не в 03:00–04:00', () => {
    for (const { input, usage } of TEMP_PROFILE.products) {
      if (usage.kind === 'rhythmic') for (const h of usage.slotHours) expect(h === 3, `${input.id}: ${h}`).toBe(false);
    }
  });
});
