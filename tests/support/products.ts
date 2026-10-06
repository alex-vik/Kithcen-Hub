// Помощники тестов каталога (T-001). Позиции собираются литералами, а не через createProduct,
// чтобы тесты правки и порции не зависели от создания.
import type { Norm, NormPeriod, Product } from '../../src/domain/catalog.ts';
import type { CommandResult } from '../../src/domain/result.ts';

export const DAY: NormPeriod = { kind: 'day' };
export const WEEK: NormPeriod = { kind: 'week' };
export const days = (n: number): NormPeriod => ({ kind: 'days', days: n });

export function norm(dailyMilli: number, enteredMilli: number, period: NormPeriod): Norm {
  return { dailyMilli, enteredMilli, period };
}

/** Минимальная активная позиция в граммах; поля переопределяются. */
export function product(overrides: Partial<Product> = {}): Product {
  return {
    name: 'Позиция',
    category: null,
    writeOffType: null,
    unit: 'г',
    pack: null,
    norm: null,
    lowThresholdMilli: null,
    portionMilli: null,
    active: true,
    ...overrides,
  };
}

/** Позиция «Кофе молотый» из К2 в виде литерала. */
export function coffee(): Product {
  return product({
    name: 'Кофе молотый',
    category: 'Напитки',
    writeOffType: 'rhythmic',
    unit: 'г',
    pack: { name: 'пачка', sizeMilli: 250000 },
    norm: norm(30000, 30000, DAY),
    lowThresholdMilli: 100000,
    portionMilli: 15000,
  });
}

/** Успех результата команды → значение; иначе падение теста с кодом отказа. */
export function value<T, E extends string>(r: CommandResult<T, E>): T {
  if (!r.ok) throw new Error(`ожидался успех, получен отказ: ${r.error}`);
  return r.value;
}

/** Отказ результата команды → код; иначе падение теста. */
export function errorOf<T, E extends string>(r: CommandResult<T, E>): E {
  if (r.ok) throw new Error('ожидался отказ, получен успех');
  return r.error;
}
