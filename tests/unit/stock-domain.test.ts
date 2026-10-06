// T-003: чистая свёртка и проверки журнала остатка — без базы (ADR-003, ADR-004).
// Переведены T-002 К1, К7, К9; новые К5, К7 (минус), К9 (домен).
import { describe, expect, test } from 'vitest';
import { foldStock, validateStockEventInput } from '../../src/domain/index.ts';
import { fe, milkEvents, usedAfter, usedBefore } from '../helpers/stock.ts';

const T = '2026-10-04T12:00:00Z';

describe('T-002 К1 (T-003): позиция без событий', () => {
  test('T-003 К5: остаток 0, шагов нет', () => {
    expect(foldStock([])).toEqual({ balance: 0, steps: [] });
  });
});

describe('T-003 К5: свёртка на новых типах (BR-01)', () => {
  test('T-003 К5: молоко — остаток 2, шаг «пересчитал» 5→3', () => {
    const r = foldStock(milkEvents());
    expect(r.balance).toBe(2);
    expect(r.steps).toEqual([
      { eventId: 'e1', before: 0, after: 6 },
      { eventId: 'e2', before: 6, after: 5 },
      { eventId: 'e3', before: 5, after: 3 },
      { eventId: 'e4', before: 3, after: 2 },
    ]);
  });
  test('T-003 К5: «использовал» задним числом до «пересчитал» — остаток 2, шаг 4→3', () => {
    const r = foldStock([...milkEvents(), usedBefore()]);
    expect(r.balance).toBe(2);
    expect(r.steps.map((s) => s.eventId)).toEqual(['e1', 'e5', 'e2', 'e3', 'e4']);
    expect(r.steps.find((s) => s.eventId === 'e3')).toEqual({ eventId: 'e3', before: 4, after: 3 });
  });
  test('T-003 К5: «использовал» после «пересчитал» — остаток 1', () => {
    expect(foldStock([...milkEvents(), usedAfter()]).balance).toBe(1);
  });
});

describe('T-002 К7 (T-003): порядок по (occurred_at, seq), а не по входу', () => {
  const rc = (seq: number) => fe('rc', 'recount', 10, T, seq);
  const buy = (seq: number) => fe('buy', 'purchase', 5, T, seq);
  test('T-003 К5: «пересчитал» seq 1, покупка seq 2 → 15', () => {
    expect(foldStock([buy(2), rc(1)]).balance).toBe(15);
    expect(foldStock([rc(1), buy(2)]).balance).toBe(15);
  });
  test('T-003 К5: seq наоборот → 10', () => {
    expect(foldStock([rc(2), buy(1)]).balance).toBe(10);
    expect(foldStock([buy(1), rc(2)]).balance).toBe(10);
  });
  test('T-003 К5: события в обратном порядке дают тот же результат', () => {
    const sorted = [...milkEvents(), usedBefore()];
    expect(foldStock([...sorted].reverse())).toEqual(foldStock(sorted));
  });
});

describe('T-002 К9 (T-003): свёртка чистая', () => {
  test('T-003 К5: дважды — равные результаты, вход не изменён', () => {
    const input = [...milkEvents(), usedBefore()].reverse();
    const copy = structuredClone(input);
    input.forEach((e) => Object.freeze(e));
    Object.freeze(input);
    expect(foldStock(input)).toEqual(foldStock(input));
    expect(input).toEqual(copy);
  });
});

describe('T-003 К7: «закончилось» обнуляет, минус не блокируется (BR-15)', () => {
  const base = [
    fe('a', 'purchase', 1, '2026-10-01T10:00:00Z', 1),
    fe('b', 'used', 2, '2026-10-02T10:00:00Z', 2),
  ];
  test('T-003 К7: 1 − 2 = −1', () => {
    expect(foldStock(base).balance).toBe(-1);
  });
  test('T-003 К7: «закончилось» заменяет минус нулём, затем покупка 4 → 4', () => {
    const r = foldStock([
      ...base,
      fe('c', 'ran_out', null, '2026-10-03T10:00:00Z', 3),
      fe('d', 'purchase', 4, '2026-10-04T10:00:00Z', 4),
    ]);
    expect(r.steps.map((s) => s.after)).toEqual([1, -1, 0, 4]);
    expect(r.steps[2]).toEqual({ eventId: 'c', before: -1, after: 0 });
  });
  test('T-003 К7: «пересчитал» заменяет минус значением', () => {
    const r = foldStock([...base, fe('c', 'recount', 3, '2026-10-03T10:00:00Z', 3)]);
    expect(r.steps[2]).toEqual({ eventId: 'c', before: -1, after: 3 });
  });
});

// --- К9: проверка ввода события ---
const base = { id: 'ev-1', productId: 'p-1' };
const fieldsOf = (r: { ok: boolean; errors?: { field: string }[] }): string[] =>
  r.ok ? [] : (r.errors ?? []).map((e) => e.field);

const bad: [string, Record<string, unknown>, string][] = [
  ...['portion', 'auto_writeoff', 'inventory', 'cancel', 'foo'].map((t): [string, Record<string, unknown>, string] => [
    `тип «${t}»`, { type: t, qty: 1 }, 'type',
  ]),
  ['тип не задан', {}, 'type'],
  ['покупка без количества', { type: 'purchase' }, 'qty'],
  ['покупка 0', { type: 'purchase', qty: 0 }, 'qty'],
  ['покупка −1', { type: 'purchase', qty: -1 }, 'qty'],
  ['«использовал» 0', { type: 'used', qty: 0 }, 'qty'],
  ['«использовал» −1', { type: 'used', qty: -1 }, 'qty'],
  ['«пересчитал» без значения', { type: 'recount' }, 'qty'],
  ['«пересчитал» −1', { type: 'recount', qty: -1 }, 'qty'],
];

describe('T-003 К9 (домен): недопустимый ввод отклоняется с именем поля', () => {
  test.each(bad)('T-003 К9: %s', (_n, input, field) => {
    const r = validateStockEventInput({ ...base, ...input });
    expect(r.ok).toBe(false);
    expect(fieldsOf(r)).toContain(field);
  });

  const good: [string, Record<string, unknown>][] = [
    ['«пересчитал» 0', { type: 'recount', qty: 0 }],
    ['«пересчитал» 1,5', { type: 'recount', qty: 1.5 }],
    ['покупка 0,5', { type: 'purchase', qty: 0.5 }],
    ['«использовал» без количества (по умолчанию 1)', { type: 'used' }],
    ['«закончилось»', { type: 'ran_out' }],
    ['«использовал» больше любого остатка (BR-15)', { type: 'used', qty: 1e9 }],
  ];
  test.each(good)('T-003 К9: принимается %s', (_n, input) => {
    expect(validateStockEventInput({ ...base, ...input })).toEqual({ ok: true });
  });
});
