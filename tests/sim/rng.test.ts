import { describe, expect, it } from 'vitest';
import { createRng } from './rng.ts';

const take = (seed: number, n: number): number[] => {
  const r = createRng(seed);
  return Array.from({ length: n }, () => r.next());
};

describe('T-006 К3: детерминированный генератор', () => {
  it('T-006 К3: один сид — одна последовательность из 10 000, другой сид — другая', () => {
    const a = take(20261006, 10_000);
    const b = take(20261006, 10_000);
    const c = take(20261007, 10_000);
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
    expect(c.filter((x, i) => x === a[i]).length).toBeLessThan(5);
  });

  it('T-006 К3: все числа в [0, 1) и распределены не вырожденно', () => {
    const a = take(1, 10_000);
    expect(a.every((x) => x >= 0 && x < 1)).toBe(true);
    const mean = a.reduce((s, x) => s + x, 0) / a.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
    expect(new Set(a).size).toBeGreaterThan(9_990);
  });
});
