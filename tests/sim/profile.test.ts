import { describe, expect, it } from 'vitest';
import { createProduct } from '../../src/domain/catalog.ts';
import { MIN_PER_TYPE, PROFILE_SIZE } from './config.ts';
import { TEMP_PROFILE } from './profile.ts';
import { renderSummary, summarizeProfile } from './summary.ts';
import { nth } from './util.ts';

const prods = TEMP_PROFILE.products;

describe('T-006 К1: состав временного профиля', () => {
  it('T-006 К1: 20–30 позиций, каждого типа не меньше 3', () => {
    expect(prods.length).toBeGreaterThanOrEqual(PROFILE_SIZE.min);
    expect(prods.length).toBeLessThanOrEqual(PROFILE_SIZE.max);
    for (const kind of ['rhythmic', 'burst', 'slow'] as const) {
      expect(prods.filter((p) => p.usage.kind === kind).length).toBeGreaterThanOrEqual(MIN_PER_TYPE);
    }
  });

  it('T-006 К1: двое взрослых и собака 6 кг; корм собаки — ритмичная позиция только собаки', () => {
    expect(TEMP_PROFILE.household.adults).toBe(2);
    expect(TEMP_PROFILE.household.dog.weightKg).toBe(6);
    const dogOnly = prods.filter((p) => p.consumers.length === 1 && nth(p.consumers, 0) === 'dog');
    expect(dogOnly.length).toBeGreaterThanOrEqual(1);
    expect(dogOnly.every((p) => p.usage.kind === 'rhythmic')).toBe(true);
  });

  it('T-006 К1: каждая позиция проходит createProduct; id уникальны; тип списания совпадает с usage', () => {
    for (const p of prods) {
      const r = createProduct(p.input);
      expect(r.ok, p.input.id).toBe(true);
      if (r.ok) {
        expect(r.value.writeOffType).toBe(p.usage.kind);
        expect(r.value.norm).toBeNull(); // норму выставляет пользователь, не профиль (BR-10)
      }
      expect(['г', 'мл', 'шт']).toContain(p.input.unit);
      expect(Number.isInteger(p.input.unitsPerPack)).toBe(true); // Q-30
    }
    expect(new Set(prods.map((p) => p.input.id)).size).toBe(prods.length);
  });

  it('T-006 К1: параметры расхода своего типа положительны', () => {
    for (const { usage: u } of prods) {
      if (u.kind === 'rhythmic') {
        expect(u.dailyUnits).toBeGreaterThan(0);
        expect(u.slotHours.length).toBeGreaterThan(0);
      } else if (u.kind === 'burst') {
        expect(u.usesPerWeek).toBeGreaterThan(0);
        expect(u.unitsPerUse).toBeGreaterThan(0);
      } else {
        expect(u.packLifeDays).toBeGreaterThan(0);
      }
    }
  });

  it('T-006 К1: профиль помечен временным со ссылкой на Q-19', () => {
    expect(TEMP_PROFILE.temporary).toBe(true);
    expect(TEMP_PROFILE.source).toContain('Q-19');
    expect(TEMP_PROFILE.source).toContain('2026-10-06');
  });
});

describe('T-006 К2: сводка профиля для владельца', () => {
  const summary = summarizeProfile(TEMP_PROFILE);

  it('T-006 К2: строк столько же, сколько позиций; заголовок «ВРЕМЕННЫЙ профиль»', () => {
    expect(summary.rows).toHaveLength(prods.length);
    expect(summary.title).toContain('ВРЕМЕННЫЙ профиль');
  });

  it('T-006 К2: расход в неделю в единицах и упаковках согласован с параметрами типа', () => {
    prods.forEach((p, i) => {
      const row = nth(summary.rows, i);
      const u = p.usage;
      expect(row.name).toBe(p.input.name);
      expect(row.type).toBe(u.kind);
      expect(row.pack).toEqual({ name: p.input.packName, unitsPerPack: p.input.unitsPerPack });
      const expected =
        u.kind === 'rhythmic' ? u.dailyUnits * 7 : u.kind === 'burst' ? u.usesPerWeek * u.unitsPerUse : (p.input.unitsPerPack / u.packLifeDays) * 7;
      expect(row.weeklyUnits).toBeCloseTo(expected, 9);
      expect(row.weeklyPacks).toBeCloseTo(expected / p.input.unitsPerPack, 9);
      expect(row.packLifeDays).toBe(u.kind === 'slow' ? u.packLifeDays : null);
      expect(row.consumers).toBe(p.consumers.includes('dog') ? 'собака' : 'люди');
    });
  });

  it('T-006 К2: отрисованная таблица содержит заголовок и все позиции', () => {
    const text = renderSummary(summary);
    expect(text).toContain('ВРЕМЕННЫЙ профиль');
    for (const p of prods) expect(text).toContain(p.input.name);
    expect(text.split('\n').filter((l) => l.startsWith('| ')).length).toBe(prods.length + 2);
  });
});
