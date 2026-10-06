// T-003: отмена события, действующие события в свёртке и ленте, идемпотентность по id
// (BR-02, BR-26, FR-LOG-02, BR-01, BR-15, NFR-07, NFR-08; ADR-003 §5.1, §6, §8).
// Имя теста начинается с T-003 и номера критерия (К1…К21).
// Интерфейс (расширение src/domain/journal.ts) задан этими тестами; см. отчёт tester:
//   StockEvent.kind += 'cancel'; StockEvent.targetId?: string; StockEventInput.targetId?: string
//   cancelledIds(events): ReadonlySet<string>
//   resolveEventWrite(recorded | undefined, incoming): WriteOutcome
//   resolveSystemWrite(recorded | undefined, incoming): WriteOutcome
import { describe, expect, it } from 'vitest';
import {
  cancelledIds,
  createStockEvent,
  resolveEventWrite,
  resolveSystemWrite,
  stockBalance,
  stockLedger,
} from '../../src/domain/journal.ts';
import type { StockEvent, StockEventInput } from '../../src/domain/journal.ts';
import { createProduct, updateProduct } from '../../src/domain/catalog.ts';
import type { Product } from '../../src/domain/catalog.ts';

// ---------- данные и помощники ----------

function mkProduct(id: string, name: string, unit: 'г' | 'мл' | 'шт', unitsPerPack: number): Product {
  const r = createProduct({ id, name, unit, packName: 'упаковка', unitsPerPack });
  if (!r.ok) throw new Error(`тест: позиция не создана: ${r.error.attribute}`);
  return r.value;
}

const buckwheat = mkProduct('p-buckwheat', 'Гречка', 'г', 900);
const milk = mkProduct('p-milk', 'Молоко', 'мл', 1000);
const rice = mkProduct('p-rice', 'Рис', 'г', 800);

const at = (day: string, hhmm: string) => `2026-10-${day}T${hhmm}:00.000Z`;

const base = {
  id: 'e-1',
  seq: 1,
  occurredAt: '2026-10-12T09:00:00.000Z',
  recordedAt: '2026-10-12T09:00:05.000Z',
  source: 'kiosk',
};

type Kind = StockEvent['kind'];

/** Литерал записанного события; id = `e<seq>`; recordedAt не зависит от occurredAt. */
function E(seq: number, kind: Kind, occurredAt: string, amount?: number, productId = 'p-buckwheat'): StockEvent {
  const rec: Record<string, unknown> = {
    id: `e${seq}`,
    seq,
    productId,
    kind,
    occurredAt,
    recordedAt: `2027-01-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    source: 'test',
  };
  if (kind === 'inventory') rec.value = amount;
  else if (kind !== 'depleted') rec.quantity = amount;
  return rec as unknown as StockEvent;
}

/** Литерал отмены: ссылка на цель, без величин. */
function C(seq: number, targetId: string, occurredAt: string, id = `e${seq}`, productId = 'p-buckwheat'): StockEvent {
  return {
    id,
    seq,
    productId,
    kind: 'cancel',
    targetId,
    occurredAt,
    recordedAt: `2027-01-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    source: 'test',
  } as unknown as StockEvent;
}

const input = (o: Record<string, unknown>): StockEventInput => o as unknown as StockEventInput;

function created(r: unknown): StockEvent {
  const res = r as { ok: boolean; value?: StockEvent; error?: { attribute: string } };
  if (!res.ok) throw new Error(`тест: событие не создано: ${res.error?.attribute}`);
  return res.value as StockEvent;
}

function failedAttr(r: unknown): string {
  const res = r as { ok: boolean; error?: { attribute: string } };
  expect(res.ok).toBe(false);
  return res.error!.attribute;
}

function nth<X>(xs: readonly X[], i: number): X {
  const x = xs[i];
  if (x === undefined) throw new Error(`нет элемента с индексом ${i} (длина ${xs.length})`);
  return x;
}

function deepFreeze<X>(o: X): X {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** Детерминированные перестановки: обратная и несколько псевдослучайных. */
function shuffles<X>(a: readonly X[], n = 15): X[][] {
  let s = 20261006;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out: X[][] = [[...a].reverse()];
  for (let k = 0; k < n; k++) {
    const b = [...a];
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [b[i], b[j]] = [nth(b, j), nth(b, i)];
    }
    out.push(b);
  }
  return out;
}

const rowsOf = (j: readonly StockEvent[]) =>
  stockLedger(j).map((r) => [r.eventId, r.before, r.after, r.implicit] as const);

// Журнал К6 (гречка): +1800, -100, -250
const j6 = (): StockEvent[] => [
  E(1, 'purchase', at('12', '10:00'), 1800),
  E(2, 'portion', at('12', '20:00'), 100),
  E(3, 'recipe', at('13', '19:00'), 250),
];
// Журнал К8 (рис), без (а) и (б)
const j8 = (): StockEvent[] => [
  E(1, 'inventory', at('09', '10:00'), 1000),
  E(2, 'purchase', at('10', '12:00'), 900),
  E(3, 'recipe', at('11', '19:00'), 300),
  E(4, 'inventory', at('12', '08:00'), 200),
  E(5, 'portion', at('12', '20:00'), 100),
];
const c8a = () => C(6, 'e4', at('13', '09:00'));
const e8b = () => E(7, 'portion', at('11', '21:00'), 100);
const j8a = (): StockEvent[] => [...j8(), c8a()];
const j8b = (): StockEvent[] => [...j8a(), e8b()];
// К9: отмена отмены
const c9a = () => C(8, 'e6', at('14', '10:00'));
const c9b = () => C(9, 'e8', at('14', '11:00'));
const j9a = (): StockEvent[] => [...j8b(), c9a()];
const j9b = (): StockEvent[] => [...j9a(), c9b()];
// К11: кофе; автосписания по Вильнюсу за 09…13.10, отмены за 10…13.10
const j11 = (): StockEvent[] => [
  E(1, 'inventory', at('08', '20:00'), 500),
  E(2, 'auto_writeoff', at('08', '21:00'), 20),
  E(3, 'auto_writeoff', at('09', '21:00'), 20),
  E(4, 'auto_writeoff', at('10', '21:00'), 20),
  E(5, 'auto_writeoff', at('11', '21:00'), 20),
  E(6, 'auto_writeoff', at('12', '21:00'), 20),
  C(9, 'e3', at('15', '06:00')),
  C(10, 'e4', at('15', '06:00')),
  C(11, 'e5', at('15', '06:00')),
  C(12, 'e6', at('15', '06:00')),
];
const isCancelOfRetro = (e: StockEvent) => e.kind === 'cancel';
const e12inv = () => E(7, 'inventory', at('13', '19:00'), 480);
const e12auto = () => E(8, 'auto_writeoff', at('13', '21:00'), 20);

// ---------- К1–К2: создание отмены ----------

describe('T-003 К1-К2: создание отмены', () => {
  it('T-003 К1: отмена создаётся со ссылкой на цель, без величин', () => {
    const e = created(createStockEvent(rice, input({ ...base, id: 'c-1', kind: 'cancel', targetId: 'e-4' })));
    expect(e.kind).toBe('cancel');
    expect(e.targetId).toBe('e-4');
    expect(e.productId).toBe('p-rice');
    for (const k of ['quantity', 'value', 'packs', 'unitsPerPack']) expect(k in e, `ключ ${k}`).toBe(false);
    const allowed = new Set([
      'id', 'seq', 'productId', 'kind', 'quantity', 'value', 'packs', 'unitsPerPack',
      'targetId', 'occurredAt', 'recordedAt', 'source',
    ]);
    for (const k of Object.keys(e)) expect(allowed.has(k), `лишний ключ ${k}`).toBe(true);
    expect([e.id, e.seq, e.occurredAt, e.recordedAt, e.source]).toEqual([
      'c-1', 1, base.occurredAt, base.recordedAt, 'kiosk',
    ]);
  });

  const bad: Array<[string, Record<string, unknown>, string]> = [
    ['targetId отсутствует', {}, 'targetId'],
    ['targetId пустая строка', { targetId: '' }, 'targetId'],
    ['targetId из пробелов', { targetId: '   ' }, 'targetId'],
    ['targetId равен собственному id', { targetId: 'c-1' }, 'targetId'],
    ['лишнее quantity', { targetId: 'e-4', quantity: 100 }, 'quantity'],
    ['лишнее value 0', { targetId: 'e-4', value: 0 }, 'value'],
    ['лишнее packs', { targetId: 'e-4', packs: 1 }, 'packs'],
    ['лишнее unitsPerPack', { targetId: 'e-4', unitsPerPack: 900 }, 'unitsPerPack'],
  ];
  for (const [name, extra, attr] of bad) {
    it(`T-003 К2: ${name}`, () => {
      let r: unknown;
      expect(() => { r = createStockEvent(rice, input({ ...base, id: 'c-1', kind: 'cancel', ...extra })); }).not.toThrow();
      expect(failedAttr(r)).toBe(attr);
      expect((r as { value?: unknown }).value).toBeUndefined();
    });
  }
});

// ---------- К3–К5: хвосты ревью T-002 ----------

describe('T-003 К3-К5: createStockEvent не отбрасывает поля молча', () => {
  it('T-003 К3: packs и quantity у прихода взаимоисключающие; каждое по отдельности допустимо', () => {
    let a: unknown;
    let b: unknown;
    expect(() => {
      a = createStockEvent(buckwheat, input({ ...base, kind: 'purchase', packs: 2, quantity: 1800 }));
      b = createStockEvent(buckwheat, input({ ...base, kind: 'purchase', quantity: 450, unitsPerPack: 900 }));
    }).not.toThrow();
    expect(failedAttr(a)).toBe('quantity');
    expect(failedAttr(b)).toBe('unitsPerPack');
    // допустимые формы по-прежнему создаются (К1, К3 T-002)
    expect(created(createStockEvent(buckwheat, input({ ...base, kind: 'purchase', packs: 2 }))).quantity).toBe(1800);
    expect(created(createStockEvent(buckwheat, input({ ...base, kind: 'purchase', quantity: 450 }))).quantity).toBe(450);
  });

  type Case = [kind: string, valid: Record<string, unknown>, field: string, value: unknown];
  const cases: Case[] = [];
  for (const kind of ['portion', 'auto_writeoff', 'recipe', 'spoilage']) {
    for (const [f, v] of [['value', 5], ['packs', 1], ['unitsPerPack', 900], ['targetId', 'e-9']] as const) {
      cases.push([kind, { quantity: 100 }, f, v]);
    }
  }
  for (const [f, v] of [['value', 5], ['targetId', 'e-9']] as const) {
    cases.push(['purchase', { quantity: 450 }, f, v]);
    cases.push(['purchase', { packs: 2 }, f, v]);
  }
  for (const [f, v] of [['quantity', 100], ['packs', 1], ['unitsPerPack', 900], ['targetId', 'e-9']] as const) {
    cases.push(['inventory', { value: 1200 }, f, v]);
  }
  for (const [f, v] of [['quantity', 100], ['value', 5], ['value', 0], ['packs', 1], ['unitsPerPack', 900], ['targetId', 'e-9']] as const) {
    cases.push(['depleted', {}, f, v]);
  }

  for (const [kind, valid, field, value] of cases) {
    it(`T-003 К4: ${kind} (${Object.keys(valid).join(',') || 'без величин'}) с лишним ${field}=${String(value)}`, () => {
      let r: unknown;
      expect(() => { r = createStockEvent(buckwheat, input({ ...base, kind, ...valid, [field]: value })); }).not.toThrow();
      expect(failedAttr(r)).toBe(field);
      expect((r as { value?: unknown }).value).toBeUndefined();
    });
  }

  it('T-003 К4: поле со значением undefined считается отсутствующим', () => {
    const undef = { value: undefined, packs: undefined, unitsPerPack: undefined, targetId: undefined, quantity: undefined };
    // лишнее поле по-прежнему отвергается, а undefined у остальных не мешает
    expect(failedAttr(createStockEvent(buckwheat, input({ ...base, kind: 'depleted', ...undef, value: 0 })))).toBe('value');
    const ok = [
      createStockEvent(buckwheat, input({ ...base, kind: 'portion', ...undef, quantity: 100 })),
      createStockEvent(buckwheat, input({ ...base, kind: 'purchase', ...undef, packs: 2 })),
      createStockEvent(buckwheat, input({ ...base, kind: 'purchase', ...undef, quantity: 450 })),
      createStockEvent(buckwheat, input({ ...base, kind: 'inventory', ...undef, value: 0 })),
      createStockEvent(buckwheat, input({ ...base, kind: 'depleted', ...undef })),
      createStockEvent(buckwheat, input({ ...base, kind: 'cancel', ...undef, targetId: 'e-4' })),
    ];
    for (const r of ok) expect((r as { ok: boolean }).ok).toBe(true);
  });

  // Эти проверки уже реализованы в T-002; тесты фиксируют их (мутанты: убрать trim, Number.isInteger).
  const k5: Array<[string, Record<string, unknown>, string]> = [
    ['seq NaN', { seq: NaN }, 'seq'],
    ['seq 1,5', { seq: 1.5 }, 'seq'],
    ['kind transfer', { kind: 'transfer' }, 'kind'],
    ['id из пробелов', { id: '   ' }, 'id'],
    ['source из пробелов', { source: '   ' }, 'source'],
  ];
  for (const [name, patch, attr] of k5) {
    it(`T-003 К5: ${name}`, () => {
      let r: unknown;
      expect(() => { r = createStockEvent(rice, input({ ...base, kind: 'portion', quantity: 1, ...patch })); }).not.toThrow();
      expect(failedAttr(r)).toBe(attr);
    });
  }
});

// ---------- К6–К14: свёртка с отменами ----------

describe('T-003 К6-К14: действующие события и свёртка', () => {
  it('T-003 К6: отмена приращения равносильна компенсации во всех точках после события', () => {
    const j = [...j6(), C(4, 'e2', at('14', '09:00'))];
    expect(stockBalance(j)).toBe(1550);
    expect(stockBalance(j, at('12', '20:00'))).toBe(1800);
    expect(stockBalance(j, at('13', '19:00'))).toBe(1550);
    // без отмены на 100 меньше в каждой точке с 12.10 20:00
    expect(stockBalance(j6())).toBe(1450);
    expect(stockBalance(j6(), at('12', '20:00'))).toBe(1700);
    expect(stockBalance(j6(), at('12', '19:59'))).toBe(1800);
    for (const p of shuffles(j)) {
      expect(stockBalance(p)).toBe(1550);
      expect(stockBalance(p, at('12', '20:00'))).toBe(1800);
    }
  });

  it('T-003 К7: отмена любого события равносильна его удалению из журнала (остаток и лента)', () => {
    const j = (): StockEvent[] => [
      E(1, 'purchase', at('12', '08:00'), 1000),
      E(2, 'portion', at('12', '09:00'), 100),
      E(3, 'recipe', at('12', '10:00'), 150),
      E(4, 'depleted', at('12', '11:00')),
      E(5, 'spoilage', at('12', '12:00'), 50),
      E(6, 'inventory', at('12', '13:00'), 500),
      E(7, 'auto_writeoff', at('12', '14:00'), 20),
      C(8, 'e5', at('12', '15:00')), // действующая цель: spoilage
    ];
    expect(stockBalance(j())).toBe(480);
    const kinds = new Set(j().map((e) => e.kind));
    for (const k of ['purchase', 'portion', 'auto_writeoff', 'recipe', 'spoilage', 'inventory', 'depleted', 'cancel']) {
      expect(kinds.has(k as Kind), `в журнале нет вида ${k}`).toBe(true);
    }
    const balances = new Map<string, number>();
    for (const target of j()) {
      const withCancel = [...j(), C(100, target.id, at('13', '09:00'), `x-${target.id}`)];
      const without = j().filter((e) => e.id !== target.id);
      expect(stockBalance(withCancel), `остаток, отмена ${target.id}`).toBe(stockBalance(without));
      expect(rowsOf(withCancel), `лента, отмена ${target.id}`).toEqual(rowsOf(without));
      balances.set(target.id, stockBalance(withCancel));
    }
    expect(balances.get('e6')).toBe(-20); // отмена инвентаризации
    expect(balances.get('e7')).toBe(500); // отмена автосписания
    expect(balances.get('e8')).toBe(480); // отмена отмены: spoilage снова действует, но инвентаризация после него
    expect(stockBalance(j().filter((e) => e.id !== 'e8'))).toBe(480);
    // отмена отмены меняет ленту: у spoilage снова есть строка
    const rowIds = rowsOf([...j(), C(100, 'e8', at('13', '09:00'), 'x-e8')]).map((r) => r[0]);
    expect(rowIds).toContain('e5');
  });

  it('T-003 К8: отмена ошибочной инвентаризации и событие задним числом после неё', () => {
    expect(stockBalance(j8())).toBe(100);
    expect(stockBalance(j8a())).toBe(1500);
    expect(stockBalance(j8b())).toBe(1400);
    for (const p of shuffles(j8b())) expect(stockBalance(p)).toBe(1400);
  });

  it('T-003 К9: отмена отмены восстанавливает событие; цепочка любой длины', () => {
    expect(stockBalance(j9a())).toBe(100);
    expect(stockBalance(j9b())).toBe(1400);
    const c10 = C(10, 'e9', at('14', '12:00'));
    const c11 = C(11, 'e10', at('14', '13:00'));
    expect(stockBalance([...j9b(), c10])).toBe(100);
    expect(stockBalance([...j9b(), c10, c11])).toBe(1400);
    for (const p of shuffles(j9a())) expect(stockBalance(p)).toBe(100);
    for (const p of shuffles([...j9b(), c10, c11])) expect(stockBalance(p)).toBe(1400);
  });

  it('T-003 К9: порядок отмен задаёт seq, а не occurredAt: отмена отмены с более ранним временем действует', () => {
    // отмена seq 8 записана позже (больший seq), но её occurredAt раньше, чем у отменяемой seq 6
    const early = C(8, 'e6', at('13', '08:00'));
    expect(stockBalance([...j8b(), early])).toBe(100);
    for (const p of shuffles([...j8b(), early])) expect(stockBalance(p)).toBe(100);
  });

  it('T-003 К10: две отмены одного события', () => {
    const jb = (): StockEvent[] => [
      E(1, 'purchase', at('12', '10:00'), 1800),
      E(2, 'portion', at('12', '11:00'), 100),
      C(3, 'e2', at('13', '09:00'), 'c-a'),
      C(4, 'e2', at('13', '10:00'), 'c-b'),
    ];
    expect(stockBalance(jb())).toBe(1800);
    const ja = [...jb(), C(5, 'c-a', at('13', '11:00'))];
    expect(stockBalance(ja)).toBe(1800); // c-b продолжает действовать
    const jab = [...ja, C(6, 'c-b', at('13', '12:00'))];
    expect(stockBalance(jab)).toBe(1700);
    for (const p of shuffles(jab)) expect(stockBalance(p)).toBe(1700);
    for (const p of shuffles(ja)) expect(stockBalance(p)).toBe(1800);
  });

  it('T-003 К11: отмена действует на всю ось времени, независимо от asOf и собственного времени', () => {
    expect(stockBalance(j11(), at('12', '12:00'))).toBe(480);
    expect(stockBalance(j11().filter((e) => !isCancelOfRetro(e)), at('12', '12:00'))).toBe(420);
    expect(stockBalance(j11())).toBe(480);
    expect(stockBalance(j11().filter((e) => !isCancelOfRetro(e)))).toBe(400);
    for (const p of shuffles(j11())) {
      expect(stockBalance(p, at('12', '12:00'))).toBe(480);
      expect(stockBalance(p)).toBe(480);
    }
  });

  it('T-003 К12: ретро-отпуск после инвентаризации', () => {
    const withInv = [...j11(), e12inv(), e12auto()];
    const noCancels = withInv.filter((e) => !isCancelOfRetro(e));
    expect(stockBalance(noCancels)).toBe(460);
    expect(stockBalance(withInv)).toBe(460);
    const noInv = withInv.filter((e) => e.id !== 'e7');
    expect(stockBalance(noInv.filter((e) => !isCancelOfRetro(e)))).toBe(380);
    expect(stockBalance(noInv)).toBe(460);
    for (const p of shuffles(noInv)) expect(stockBalance(p)).toBe(460);
  });

  it('T-003 К13: отмена с неизвестной целью не влияет на расчёт, без исключений', () => {
    const plain = j6(); // журнал К6 без отмены seq 4
    const j = [...plain, C(4, 'нет-такого', at('14', '09:00'))];
    let bal = NaN;
    let rows: unknown;
    expect(() => { bal = stockBalance(j); rows = rowsOf(j); }).not.toThrow();
    expect(bal).toBe(1450);
    expect(rows).toEqual(rowsOf(plain));
    expect(() => cancelledIds(j)).not.toThrow();
  });

  it('T-003 К14: множество отменённых событий', () => {
    const ids = (j: readonly StockEvent[]) => [...cancelledIds(j)].sort();
    expect(ids(j9a())).toEqual(['e6']);
    expect(ids(j8b())).toEqual(['e4']);
    expect(ids(j8())).toEqual([]);
    const jb = [
      E(1, 'purchase', at('12', '10:00'), 1800),
      E(2, 'portion', at('12', '11:00'), 100),
      C(3, 'e2', at('13', '09:00'), 'c-a'),
      C(4, 'e2', at('13', '10:00'), 'c-b'),
      C(5, 'c-a', at('13', '11:00')),
    ];
    expect(ids(jb)).toEqual(['c-a', 'e2']);
    for (const p of shuffles(j9a())) expect(ids(p)).toEqual(['e6']);
  });
});

// ---------- К15–К17: лента ----------

describe('T-003 К15-К17: лента остатка с отменами', () => {
  it('T-003 К15: в ленте только действующие события, без строк отмен', () => {
    const expected = [
      ['e1', 0, 1000, 1000],
      ['e2', 1000, 1900, null],
      ['e3', 1900, 1600, null],
      ['e7', 1600, 1500, null],
      ['e5', 1500, 1400, null],
    ];
    expect(rowsOf(j8b())).toEqual(expected);
    for (const p of shuffles(j8b())) expect(rowsOf(p)).toEqual(expected);
  });

  it('T-003 К15: число строк равно числу действующих событий, не являющихся отменой; цепочка непрерывна', () => {
    for (const j of [j8b(), j9a(), j9b(), j11(), [...j11(), e12inv(), e12auto()]]) {
      const cancelled = cancelledIds(j);
      const active = j.filter((e) => e.kind !== 'cancel' && !cancelled.has(e.id));
      const rows = stockLedger([...j].reverse());
      expect(rows).toHaveLength(active.length);
      expect(new Set(rows.map((r) => r.eventId))).toEqual(new Set(active.map((e) => e.id)));
      rows.forEach((r, i) => {
        if (i > 0) expect(r.before).toBe(nth(rows, i - 1).after);
      });
      expect(nth(rows, rows.length - 1).after).toBe(stockBalance(j));
    }
  });

  it('T-003 К16: неявное приращение пересчитывается после отмены', () => {
    const rows = stockLedger(j9a());
    const r4 = rows.find((r) => r.eventId === 'e4');
    expect(r4).toEqual({ eventId: 'e4', before: 1500, after: 200, implicit: -1300 });
    const last = nth(rows, rows.length - 1);
    expect([last.eventId, last.before, last.after]).toEqual(['e5', 200, 100]);

    const implicitOf = (j: StockEvent[]) => stockLedger(j).find((r) => r.eventId === 'e7')?.implicit;
    const all = [...j11(), e12inv(), e12auto()];
    expect(implicitOf(all.filter((e) => !isCancelOfRetro(e)))).toBe(80);
    expect(implicitOf(all)).toBe(0);
  });

  it('T-003 К17: функции не изменяют вход', () => {
    const j = deepFreeze(nth(shuffles(j9a(), 3), 2));
    const copy = structuredClone(j);
    expect(() => {
      stockBalance(j);
      stockBalance(j, at('12', '12:00'));
      stockLedger(j);
      cancelledIds(j);
    }).not.toThrow();
    expect(j).toEqual(copy);
    expect(j.map((e) => e.id)).toEqual(copy.map((e) => e.id));
  });
});

// ---------- К18–К21: идемпотентность ----------

describe('T-003 К18-К21: идемпотентность по id', () => {
  const recordedAtFirst = '2026-10-12T09:00:05.000Z';
  const recordedAtRetry = '2026-10-12T09:00:40.000Z';
  const first = { ...base, id: 'e-7', seq: 12, recordedAt: recordedAtFirst };
  const retry = { ...base, id: 'e-7', seq: 15, recordedAt: recordedAtRetry };

  const portion = (p: Record<string, unknown>, product: Product = rice) =>
    created(createStockEvent(product, input({ kind: 'portion', quantity: 100, ...p })));

  it('T-003 К18: нет записанного — записать новое', () => {
    const incoming = portion({ ...retry });
    const out = resolveEventWrite(undefined, incoming);
    expect(out.outcome).toBe('new');
    expect(out.event).toEqual(incoming);
  });

  it('T-003 К19: повтор с тем же содержимым возвращает записанное, а не входящее', () => {
    const pairs: Array<[string, StockEvent, StockEvent]> = [
      ['порция', portion({ ...first }), portion({ ...retry })],
      [
        'покупка 2 уп.',
        created(createStockEvent(buckwheat, input({ ...first, kind: 'purchase', packs: 2 }))),
        created(createStockEvent(buckwheat, input({ ...retry, kind: 'purchase', packs: 2 }))),
      ],
      [
        'отмена',
        created(createStockEvent(rice, input({ ...first, id: 'c-7', kind: 'cancel', targetId: 'e-4' }))),
        created(createStockEvent(rice, input({ ...retry, id: 'c-7', kind: 'cancel', targetId: 'e-4' }))),
      ],
    ];
    for (const [name, recorded, incoming] of pairs) {
      const out = resolveEventWrite(recorded, incoming);
      expect(out.outcome, name).toBe('repeat');
      expect(out.event.seq, name).toBe(12);
      expect(out.event.recordedAt, name).toBe(recordedAtFirst);
      expect(out.event, name).toEqual(recorded);
    }
  });

  it('T-003 К20: повтор с другим содержимым — конфликт без перезаписи', () => {
    const recorded = portion({ ...first });
    const purchaseRec = created(createStockEvent(buckwheat, input({ ...first, kind: 'purchase', packs: 2 })));
    const cancelRec = created(createStockEvent(rice, input({ ...first, kind: 'cancel', targetId: 'e-4' })));
    const shrunk = updateProduct(buckwheat, { unitsPerPack: 800 });
    if (!shrunk.ok) throw new Error('тест: updateProduct упал');

    const variants: Array<[string, StockEvent, StockEvent]> = [
      ['quantity', recorded, portion({ ...retry, quantity: 150 })],
      ['kind', recorded, portion({ ...retry, kind: 'recipe' })],
      ['occurredAt +1 мс', recorded, portion({ ...retry, occurredAt: '2026-10-12T09:00:00.001Z' })],
      ['source', recorded, portion({ ...retry, source: 'phone' })],
      ['productId', recorded, portion({ ...retry }, milk)],
      [
        'targetId у отмены',
        cancelRec,
        created(createStockEvent(rice, input({ ...retry, kind: 'cancel', targetId: 'e-5' }))),
      ],
      [
        'packs у покупки',
        purchaseRec,
        created(createStockEvent(buckwheat, input({ ...retry, kind: 'purchase', packs: 3 }))),
      ],
      [
        'packs 1 × 1800 при той же quantity 1800',
        purchaseRec,
        created(createStockEvent(buckwheat, input({ ...retry, kind: 'purchase', packs: 1, unitsPerPack: 1800 }))),
      ],
      [
        'коэффициент карточки изменён между повторами (НВ-1, вариант а)',
        purchaseRec,
        created(createStockEvent(shrunk.value, input({ ...retry, kind: 'purchase', packs: 2 }))),
      ],
    ];
    for (const [name, rec, incoming] of variants) {
      const frozen = deepFreeze(structuredClone(rec));
      const copy = structuredClone(rec);
      const out = resolveEventWrite(frozen, deepFreeze(structuredClone(incoming)));
      expect(out.outcome, name).toBe('conflict');
      expect((out as { id?: string }).id, name).toBe('e-7');
      expect(out.event, name).toEqual(copy);
      expect(frozen, name).toEqual(copy);
    }
  });

  it('T-003 К21: системная задача — существующий id означает «выполнено», содержимое не сравнивается', () => {
    const recorded = created(createStockEvent(rice, input({ ...first, id: 'k-1', kind: 'auto_writeoff', quantity: 20 })));
    const incoming = created(createStockEvent(rice, input({ ...retry, id: 'k-1', kind: 'auto_writeoff', quantity: 25 })));
    const copy = structuredClone(recorded);
    const out = resolveSystemWrite(deepFreeze(structuredClone(recorded)), deepFreeze(structuredClone(incoming)));
    expect(out.outcome).toBe('done');
    expect(out.event).toEqual(copy);
    expect(out.event.quantity).toBe(20);

    const fresh = resolveSystemWrite(undefined, incoming);
    expect(fresh.outcome).toBe('new');
    expect(fresh.event).toEqual(incoming);
  });
});
