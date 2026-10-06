// T-002: чистая свёртка и проверки журнала остатка — без базы (ADR-003, ADR-004). К1–К9, К23 (домен), К24 (домен).
import { describe, expect, test } from 'vitest';
import { foldStock, validateStockEventInput, validateUnitChange } from '../../src/domain/index.ts';
import type { Product } from '../../src/domain/index.ts';
import { adrCoffee, fe, portionAfter, portionBefore } from '../helpers/stock.ts';
import { coffee } from '../helpers/products.ts';

const T = '2026-10-04T12:00:00Z';

describe('T-002 К1: позиция без событий', () => {
  test('T-002 К1: остаток 0, шагов нет', () => {
    expect(foldStock([])).toEqual({ balance: 0, steps: [] });
  });
});

describe('T-002 К2: дельты складываются со знаком по типу', () => {
  test('T-002 К2: 500 −10 −20 −30 −40 = 400, шаги', () => {
    const r = foldStock([
      fe('a', 'purchase', 500, '2026-10-01T10:00:00Z', 1),
      fe('b', 'portion', 10, '2026-10-02T10:00:00Z', 2),
      fe('c', 'auto_writeoff', 20, '2026-10-03T10:00:00Z', 3),
      fe('d', 'recipe_writeoff', 30, '2026-10-04T10:00:00Z', 4),
      fe('e', 'spoilage', 40, '2026-10-05T10:00:00Z', 5),
    ]);
    expect(r.balance).toBe(400);
    expect(r.steps).toEqual([
      { eventId: 'a', before: 0, after: 500 },
      { eventId: 'b', before: 500, after: 490 },
      { eventId: 'c', before: 490, after: 470 },
      { eventId: 'd', before: 470, after: 440 },
      { eventId: 'e', before: 440, after: 400 },
    ]);
  });
});

describe('T-002 К3: «закончилось» обнуляет', () => {
  test('T-002 К3: следующая покупка прибавляется к нулю', () => {
    const r = foldStock([
      fe('a', 'purchase', 500, '2026-10-01T10:00:00Z', 1),
      fe('b', 'portion', 10, '2026-10-02T10:00:00Z', 2),
      fe('c', 'ran_out', null, '2026-10-03T10:00:00Z', 3),
      fe('d', 'purchase', 250, '2026-10-04T10:00:00Z', 4),
    ]);
    expect(r.balance).toBe(250);
    expect(r.steps[2]).toEqual({ eventId: 'c', before: 490, after: 0 });
  });
});

describe('T-002 К4: инвентаризация задаёт значение', () => {
  test('T-002 К4: остаток 430, шаг инвентаризации 480→450, дельта нигде не задана', () => {
    const input = adrCoffee();
    expect(input.some((e) => 'delta' in e)).toBe(false);
    const r = foldStock(input);
    expect(r.balance).toBe(430);
    expect(r.steps.find((s) => s.eventId === 'e3')).toEqual({ eventId: 'e3', before: 480, after: 450 });
  });
});

describe('T-002 К5: событие задним числом до последнего значения', () => {
  test('T-002 К5: остаток 430, шаг инвентаризации 470→450, порция между автосписанием и инвентаризацией', () => {
    const r = foldStock([...adrCoffee(), portionBefore()]);
    expect(r.balance).toBe(430);
    expect(r.steps.map((s) => s.eventId)).toEqual(['e1', 'e2', 'e5', 'e3', 'e4']);
    expect(r.steps.find((s) => s.eventId === 'e3')).toEqual({ eventId: 'e3', before: 470, after: 450 });
  });
});

describe('T-002 К6: событие задним числом после последнего значения', () => {
  test('T-002 К6: остаток 420', () => {
    expect(foldStock([...adrCoffee(), portionAfter()]).balance).toBe(420);
  });
});

describe('T-002 К7: порядок по (occurred_at, seq), а не по входу', () => {
  const inv = (seq: number) => fe('inv', 'inventory', 100, T, seq);
  const buy = (seq: number) => fe('buy', 'purchase', 50, T, seq);
  test('T-002 К7 (а): инвентаризация seq 1, покупка seq 2 → 150', () => {
    expect(foldStock([buy(2), inv(1)]).balance).toBe(150);
    expect(foldStock([inv(1), buy(2)]).balance).toBe(150);
  });
  test('T-002 К7 (б): seq наоборот → 100', () => {
    expect(foldStock([inv(2), buy(1)]).balance).toBe(100);
    expect(foldStock([buy(1), inv(2)]).balance).toBe(100);
  });
  test('T-002 К7 (в): события К5 в обратном и перемешанном порядке дают тот же результат', () => {
    const sorted = [...adrCoffee(), portionBefore()];
    const expected = foldStock(sorted);
    const [e1, e2, e3, e4, e5] = sorted as [typeof sorted[0], typeof sorted[0], typeof sorted[0], typeof sorted[0], typeof sorted[0]];
    expect(foldStock([...sorted].reverse())).toEqual(expected);
    expect(foldStock([e4, e1, e5, e3, e2])).toEqual(expected);
  });
});

describe('T-002 К8: минус не блокируется (BR-15)', () => {
  const base = [
    fe('a', 'purchase', 100, '2026-10-01T10:00:00Z', 1),
    fe('b', 'portion', 150, '2026-10-02T10:00:00Z', 2),
  ];
  test('T-002 К8: −50 без ошибки', () => {
    expect(foldStock(base).balance).toBe(-50);
  });
  test('T-002 К8: инвентаризация 200 заменяет минус', () => {
    const r = foldStock([...base, fe('c', 'inventory', 200, '2026-10-03T10:00:00Z', 3)]);
    expect(r.balance).toBe(200);
    expect(r.steps[2]).toEqual({ eventId: 'c', before: -50, after: 200 });
  });
  test('T-002 К8: «закончилось» заменяет минус нулём', () => {
    const r = foldStock([...base, fe('c', 'ran_out', null, '2026-10-03T10:00:00Z', 3)]);
    expect(r.balance).toBe(0);
    expect(r.steps[2]).toEqual({ eventId: 'c', before: -50, after: 0 });
  });
});

describe('T-002 К9: свёртка чистая', () => {
  test('T-002 К9: дважды — равные результаты, вход не изменён', () => {
    const input = [...adrCoffee(), portionBefore()].reverse();
    const copy = structuredClone(input);
    input.forEach((e) => Object.freeze(e));
    Object.freeze(input);
    const a = foldStock(input);
    const b = foldStock(input);
    expect(a).toEqual(b);
    expect(input).toEqual(copy);
  });
});

// --- К23: проверка ввода события (Р-3) ---
const base = { id: 'ev-1', productId: 'p-1' };
const fieldsOf = (r: { ok: boolean; errors?: { field: string }[] }): string[] =>
  r.ok ? [] : (r.errors ?? []).map((e) => e.field);

// [название, ввод, допустимые поля ошибки — достаточно, чтобы среди ошибок было одно из них]
const bad: [string, Record<string, unknown>, string[]][] = [
  ['тип «cancel» (до B-03)', { type: 'cancel' }, ['type']],
  ['неизвестный тип', { type: 'foo' }, ['type']],
  ['тип не задан', {}, ['type']],
  ...[0, -1].map((q): [string, Record<string, unknown>, string[]] => [
    `порция с количеством ${q}`, { type: 'portion', qty: q }, ['qty'],
  ]),
  ['порция без количества', { type: 'portion' }, ['qty']],
  ...(['purchase', 'auto_writeoff', 'recipe_writeoff', 'spoilage'] as const).map((t): [string, Record<string, unknown>, string[]] => [
    `${t} с количеством 0`, { type: t, qty: 0 }, ['qty'],
  ]),
  ['инвентаризация со значением -1', { type: 'inventory', qty: -1 }, ['qty']],
  ['инвентаризация без значения', { type: 'inventory' }, ['qty']],
  ['покупка с числом упаковок 0', { type: 'purchase', packages: 0 }, ['packages']],
  ['покупка без количества и без упаковок', { type: 'purchase' }, ['qty', 'packages']],
];

describe('T-002 К23 (домен): недопустимый ввод отклоняется с именем поля', () => {
  test.each(bad)('T-002 К23: %s', (_n, input, fields) => {
    const r = validateStockEventInput({ ...base, ...input });
    expect(r.ok).toBe(false);
    expect(fieldsOf(r).some((f) => fields.includes(f))).toBe(true);
  });

  const good: [string, Record<string, unknown>][] = [
    ['инвентаризация 0', { type: 'inventory', qty: 0 }],
    ['инвентаризация 12,5', { type: 'inventory', qty: 12.5 }],
    ['порция 12,5', { type: 'portion', qty: 12.5 }],
    ['0,5 упаковки', { type: 'purchase', packages: 0.5 }],
    ['коэффициент покупки 0,5', { type: 'purchase', packages: 1, packageFactor: 0.5 }],
    ['покупка в расходных единицах', { type: 'purchase', qty: 300 }],
    ['«закончилось»', { type: 'ran_out' }],
    ['порция больше любого остатка (BR-15)', { type: 'portion', qty: 1e9 }],
  ];
  test.each(good)('T-002 К23: принимается %s', (_n, input) => {
    expect(validateStockEventInput({ ...base, ...input })).toEqual({ ok: true });
  });
});

describe('T-002 К24 (домен): единица не меняется при наличии событий', () => {
  const current: Product = { id: 'p-1', ...coffee, active: true };
  test('T-002 К24: смена единицы с признаком «есть события» — consumptionUnit', () => {
    const r = validateUnitChange(current, { consumptionUnit: 'шт' }, true);
    expect(r.ok).toBe(false);
    expect(fieldsOf(r)).toContain('consumptionUnit');
  });
  test('T-002 К24: единица и норма в одной правке — тоже ошибка', () => {
    expect(fieldsOf(validateUnitChange(current, { consumptionUnit: 'шт', norm: 25 }, true))).toContain('consumptionUnit');
  });
  test('T-002 К25: без событий смена единицы допустима', () => {
    expect(validateUnitChange(current, { consumptionUnit: 'шт' }, false)).toEqual({ ok: true });
  });
  test('T-002 К25: с событиями допустимы правка без единицы и та же единица', () => {
    expect(validateUnitChange(current, { norm: 25, packageFactor: 1000, name: 'X' }, true)).toEqual({ ok: true });
    expect(validateUnitChange(current, { consumptionUnit: 'г' }, true)).toEqual({ ok: true });
  });
});
