// T-006 К3: детерминированный генератор (mulberry32). Источник случайности симулятора — только он.
export type Rng = {
  /** Число в [0, 1). */
  next(): number;
  /** Стандартное нормальное, усечённое до ±3. */
  gauss(): number;
};

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = (): number => {
    const u1 = 1 - next();
    const u2 = next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(-3, Math.min(3, z));
  };
  return { next, gauss };
}

/**
 * T-006: сид генератора позиции = f(сид прогона, id позиции) (FNV-1a по id, смешивание с сидом).
 * Правка одной позиции профиля не меняет числа остальных.
 */
export function seedFor(seed: number, productId: string): number {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  for (let i = 0; i < productId.length; i++) {
    h = Math.imul(h ^ productId.charCodeAt(i), 0x01000193) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
