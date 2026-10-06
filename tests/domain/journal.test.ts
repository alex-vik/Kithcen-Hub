// T-002: журнал событий остатка (BR-01, BR-03, BR-04, BR-06, BR-07, BR-15, NFR-08, NFR-14).
// Имя теста начинается с T-002 и номера критерия (К1…К18).
// Интерфейс модуля src/domain/journal.ts задан этими тестами; см. отчёт tester.
import { describe, expect, it } from 'vitest';
import { createStockEvent, stockBalance, stockLedger } from '../../src/domain/journal.ts';
import type { StockEvent } from '../../src/domain/journal.ts';
import { createProduct, updateProduct } from '../../src/domain/catalog.ts';
import type { Product } from '../../src/domain/catalog.ts';

// ---------- данные ----------

function mkProduct(id: string, name: string, unit: 'г' | 'мл' | 'шт', unitsPerPack: number): Product {
  const r = createProduct({ id, name, unit, packName: 'упаковка', unitsPerPack });
  if (!r.ok) throw new Error(`тест: позиция не создана: ${r.error.attribute}`);
  return r.value;
}

const buckwheat = mkProduct('p-buckwheat', 'Гречка', 'г', 900);
const milk = mkProduct('p-milk', 'Молоко', 'мл', 1000);
const rice = mkProduct('p-rice', 'Рис', 'г', 800);

const T = (s: string) => `2026-${s}Z`; // T('10-12T10:00:00.000') -> Instant
const at = (day: string, hhmm: string) => T(`10-${day}T${hhmm}:00.000`);

/** Валидный вход создания; recordedAt намеренно отличается от occurredAt. */
const base = {
  id: 'e-1',
  seq: 1,
  occurredAt: '2026-10-12T09:00:00.000Z',
  recordedAt: '2026-10-12T09:00:05.000Z',
  source: 'kiosk',
};

type Kind = StockEvent['kind'];
let counter = 0;

/**
 * Литерал записанного события для тестов свёртки: не зависит от createStockEvent.
 * recordedAt задаётся не по occurredAt, чтобы реализация «по recordedAt» не проходила.
 */
function ev(
  kind: Kind,
  occurredAt: string,
  seq: number,
  amount?: number,
  productId = 'p-buckwheat',
): StockEvent {
  counter += 1;
  const rec = {
    id: `ev-${counter}`,
    seq,
    productId,
    kind,
    occurredAt,
    recordedAt: `2027-01-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    source: 'test',
  } as Record<string, unknown>;
  if (kind === 'inventory') rec.value = amount;
  else if (kind !== 'depleted') rec.quantity = amount;
  return rec as unknown as StockEvent;
}

const SIGN: Record<string, number> = { purchase: 1, portion: -1, auto_writeoff: -1, recipe: -1, spoilage: -1 };

function permutations<X>(a: X[]): X[][] {
  if (a.length <= 1) return [a.slice()];
  const out: X[][] = [];
  a.forEach((x, i) => {
    for (const rest of permutations([...a.slice(0, i), ...a.slice(i + 1)])) out.push([x, ...rest]);
  });
  return out;
}

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

// Элемент по индексу; бросает, если его нет (noUncheckedIndexedAccess), а не подменяет проверку.
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

// Журнал К9 (гречка): 1800 -100 -250 -300 -20 = 1130
const j9 = (): StockEvent[] => [
  ev('purchase', at('12', '10:00'), 1, 1800),
  ev('portion', at('12', '20:00'), 2, 100),
  ev('recipe', at('13', '19:00'), 3, 250),
  ev('spoilage', at('14', '09:00'), 4, 300),
  ev('auto_writeoff', '2026-10-14T21:00:00.000Z', 5, 20), // 15.10 00:00 по Вильнюсу
];

// Журнал К10
const j10 = (): StockEvent[] => [
  ev('inventory', at('09', '10:00'), 1, 1000),
  ev('purchase', at('10', '12:00'), 2, 900),
  ev('recipe', at('11', '19:00'), 3, 300),
  ev('portion', at('11', '21:00'), 7, 100), // внесена задним числом: seq больше, чем у соседей по времени
];

// Журнал К11 (а): +1000, -1500 (=-500), закончилось, +900
const j11a = (): StockEvent[] => [
  ev('purchase', at('12', '10:00'), 1, 1000),
  ev('portion', at('12', '11:00'), 2, 1500),
  ev('depleted', at('12', '12:00'), 3),
  ev('purchase', at('12', '13:00'), 4, 900),
];
const j11b = (): StockEvent[] => [
  ev('purchase', at('12', '10:00'), 1, 1000),
  ev('inventory', at('12', '11:00'), 2, 400),
  ev('portion', at('12', '12:00'), 3, 100),
];
const j11c = (): StockEvent[] => [
  ev('inventory', at('12', '09:00'), 1, 400),
  ev('depleted', at('12', '10:00'), 2),
  ev('purchase', at('12', '10:00'), 3, 900),
];
// Журнал К12 до добавления
const j12before = (): StockEvent[] => [
  ev('inventory', at('12', '09:00'), 1, 400),
  ev('inventory', at('13', '10:00'), 2, 1900),
  ev('recipe', at('13', '20:00'), 3, 250),
];
const j12late = (): StockEvent => ev('purchase', at('12', '18:00'), 4, 1800);

// ---------- Создание событий ----------

describe('T-002 К1-К7: создание событий', () => {
  it('T-002 К1: приход в упаковках по коэффициенту позиции', () => {
    const e = created(createStockEvent(buckwheat, { ...base, kind: 'purchase', packs: 2 }));
    expect(e.kind).toBe('purchase');
    expect(e.quantity).toBe(1800);
    expect(e.packs).toBe(2);
    expect(e.unitsPerPack).toBe(900);
    expect(e.productId).toBe('p-buckwheat');
  });

  it('T-002 К2: упаковка другого размера — та же позиция, коэффициент позиции не меняется', () => {
    const e = created(createStockEvent(milk, { ...base, kind: 'purchase', packs: 1, unitsPerPack: 500 }));
    expect(e.quantity).toBe(500);
    expect(e.packs).toBe(1);
    expect(e.unitsPerPack).toBe(500);
    expect(e.productId).toBe('p-milk');
    expect(milk.unitsPerPack).toBe(1000);
  });

  it('T-002 К3: приход сразу в расходных единицах — packs и unitsPerPack пусты', () => {
    const e = created(createStockEvent(buckwheat, { ...base, kind: 'purchase', quantity: 450 }));
    expect(e.quantity).toBe(450);
    expect(e.packs).toBeUndefined();
    expect(e.unitsPerPack).toBeUndefined();
  });

  it('T-002 К4: события всех типов 5.2 создаются с переданным kind', () => {
    for (const [kind, q] of [['portion', 100], ['auto_writeoff', 20], ['recipe', 250], ['spoilage', 300]] as const) {
      const e = created(createStockEvent(rice, { ...base, kind, quantity: q }));
      expect(e.kind).toBe(kind);
      expect(e.quantity).toBe(q);
      expect(e.productId).toBe('p-rice');
    }
    const inv = created(createStockEvent(rice, { ...base, kind: 'inventory', value: 1200 }));
    expect(inv.kind).toBe('inventory');
    expect(inv.value).toBe(1200);
    expect(inv.quantity).toBeUndefined();
    const dep = created(createStockEvent(rice, { ...base, kind: 'depleted' }));
    expect(dep.kind).toBe('depleted');
    expect(dep.quantity).toBeUndefined();
    expect(dep.value).toBeUndefined();
  });

  it('T-002 К4: событие переносит id, seq, occurredAt, recordedAt, source без изменений', () => {
    const e = created(createStockEvent(rice, { ...base, id: 'abc', seq: 42, source: 'voice', kind: 'portion', quantity: 5 }));
    expect([e.id, e.seq, e.occurredAt, e.recordedAt, e.source]).toEqual([
      'abc', 42, base.occurredAt, base.recordedAt, 'voice',
    ]);
  });

  describe('T-002 К5: недопустимые величины отклоняются без исключения', () => {
    const cases: Array<[string, () => unknown, string]> = [];
    for (const kind of ['portion', 'auto_writeoff', 'recipe', 'spoilage', 'purchase'] as const) {
      for (const q of [0, -5, NaN, Infinity]) {
        cases.push([`${kind} quantity=${q}`, () => createStockEvent(rice, { ...base, kind, quantity: q }), 'quantity']);
      }
    }
    for (const v of [-1, NaN]) {
      cases.push([`inventory value=${v}`, () => createStockEvent(rice, { ...base, kind: 'inventory', value: v }), 'value']);
    }
    for (const p of [0, -1, NaN, 1.5]) {
      cases.push([`packs=${p}`, () => createStockEvent(rice, { ...base, kind: 'purchase', packs: p }), 'packs']);
    }
    for (const u of [0, -500]) {
      cases.push([`unitsPerPack=${u}`, () => createStockEvent(rice, { ...base, kind: 'purchase', packs: 1, unitsPerPack: u }), 'unitsPerPack']);
    }
    cases.push(['пустой id', () => createStockEvent(rice, { ...base, id: '', kind: 'portion', quantity: 1 }), 'id']);
    cases.push(['пустой source', () => createStockEvent(rice, { ...base, source: '', kind: 'portion', quantity: 1 }), 'source']);

    for (const [name, run, attr] of cases) {
      it(`T-002 К5: ${name}`, () => {
        let r: unknown;
        expect(() => { r = run(); }).not.toThrow();
        expect(failedAttr(r)).toBe(attr);
        expect((r as { value?: unknown }).value).toBeUndefined();
      });
    }

    it('T-002 К5: инвентаризация со значением 0 создаётся', () => {
      const e = created(createStockEvent(rice, { ...base, kind: 'inventory', value: 0 }));
      expect(e.value).toBe(0);
    });

    it('T-002 К5: нет ни packs, ни quantity у прихода — ошибка, не исключение', () => {
      let r: unknown;
      expect(() => { r = createStockEvent(rice, { ...base, kind: 'purchase' }); }).not.toThrow();
      expect((r as { ok: boolean }).ok).toBe(false);
    });
  });

  it('T-002 К6: ключи события — только разрешённые атрибуты (нет мест, открытости, срока годности)', () => {
    const allowed = new Set([
      'id', 'seq', 'productId', 'kind', 'quantity', 'value', 'packs', 'unitsPerPack',
      'occurredAt', 'recordedAt', 'source',
    ]);
    const inputs = [
      createStockEvent(buckwheat, { ...base, kind: 'purchase', packs: 2 }),
      createStockEvent(rice, { ...base, kind: 'portion', quantity: 100 }),
      createStockEvent(rice, { ...base, kind: 'auto_writeoff', quantity: 20 }),
      createStockEvent(rice, { ...base, kind: 'recipe', quantity: 250 }),
      createStockEvent(rice, { ...base, kind: 'spoilage', quantity: 300 }),
      createStockEvent(rice, { ...base, kind: 'inventory', value: 1200 }),
      createStockEvent(rice, { ...base, kind: 'depleted' }),
    ];
    for (const r of inputs) {
      for (const k of Object.keys(created(r))) expect(allowed.has(k), `лишний ключ ${k}`).toBe(true);
    }
  });

  it('T-002 К7: создание события не меняет позицию и входные данные', () => {
    const p = deepFreeze(mkProduct('p-buckwheat', 'Гречка', 'г', 900));
    const copy = structuredClone(p);
    const in1 = deepFreeze({ ...base, kind: 'purchase' as const, packs: 2 });
    const in2 = deepFreeze({ ...base, id: 'e-2', kind: 'purchase' as const, packs: 1, unitsPerPack: 500 });
    created(createStockEvent(p, in1));
    created(createStockEvent(p, in2));
    expect(p).toEqual(copy);
    expect(in1).toEqual({ ...base, kind: 'purchase', packs: 2 });
  });
});

// ---------- Свёртка ----------

describe('T-002 К8-К13: остаток как свёртка', () => {
  it('T-002 К8: пустой журнал — 0', () => {
    expect(stockBalance([])).toBe(0);
  });

  it('T-002 К9: приращения от нуля = 1130', () => {
    expect(stockBalance(j9())).toBeCloseTo(1130, 9);
  });

  it('T-002 К9: минус допустим и не обрезается (-100)', () => {
    expect(stockBalance([ev('portion', at('12', '20:00'), 1, 100)])).toBeCloseTo(-100, 9);
  });

  it('T-002 К9: дробные количества суммируются с допуском', () => {
    const j = [1, 2, 3].map((i) => ev('portion', at('12', `1${i}:00`), i, 0.1));
    expect(stockBalance([ev('purchase', at('12', '09:00'), 9, 1), ...j])).toBeCloseTo(0.7, 9);
  });

  it('T-002 К10: порядок (occurredAt, seq) при любой перестановке массива = 1500', () => {
    for (const p of permutations(j10())) expect(stockBalance(p)).toBeCloseTo(1500, 9);
  });

  it('T-002 К10: при равном occurredAt решает seq (инвентаризация 500 seq 9 после покупки +200 seq 8 = 500)', () => {
    const t = at('12', '10:00');
    const j = [ev('inventory', t, 9, 500), ev('purchase', t, 8, 200)];
    for (const p of permutations(j)) expect(stockBalance(p)).toBeCloseTo(500, 9);
  });

  it('T-002 К10: при обратном соотношении seq = 700', () => {
    const t = at('12', '10:00');
    const j = [ev('inventory', t, 8, 500), ev('purchase', t, 9, 200)];
    for (const p of permutations(j)) expect(stockBalance(p)).toBeCloseTo(700, 9);
  });

  it('T-002 К10: seq не главнее времени — больший seq у более раннего события не переставляет его', () => {
    // инвентаризация раньше по времени, но с большим seq; сортировка по seq дала бы 1000 (покупка +300, затем инвентаризация 1000), а не 1300
    const j = [ev('purchase', at('12', '12:00'), 1, 300), ev('inventory', at('12', '10:00'), 5, 1000)];
    for (const p of permutations(j)) expect(stockBalance(p)).toBeCloseTo(1300, 9);
  });

  it('T-002 К11 (а): «закончилось» обнуляет отрицательный остаток; затем +900 = 900', () => {
    for (const p of permutations(j11a())) expect(stockBalance(p)).toBeCloseTo(900, 9);
  });

  it('T-002 К11 (а): до «закончилось» остаток отрицателен (-500)', () => {
    expect(stockBalance(j11a(), at('12', '11:00'))).toBeCloseTo(-500, 9);
  });

  it('T-002 К11 (б): инвентаризация отбрасывает прошлые приращения: 300', () => {
    for (const p of permutations(j11b())) expect(stockBalance(p)).toBeCloseTo(300, 9);
  });

  it('T-002 К11 (в): «закончилось» seq 2 и покупка seq 3 в один момент = 900', () => {
    for (const p of permutations(j11c())) expect(stockBalance(p)).toBeCloseTo(900, 9);
  });

  it('T-002 К11 (в): при обратных seq выходит 0, а не 900', () => {
    const t = at('12', '10:00');
    const j = [ev('inventory', at('12', '09:00'), 1, 400), ev('purchase', t, 2, 900), ev('depleted', t, 3)];
    expect(stockBalance(j)).toBeCloseTo(0, 9);
  });

  it('T-002 К12: покупка задним числом раньше инвентаризации не меняет остаток 1650', () => {
    expect(stockBalance(j12before())).toBeCloseTo(1650, 9);
    expect(stockBalance([...j12before(), j12late()])).toBeCloseTo(1650, 9);
  });

  it('T-002 К12: неявное приращение инвентаризации seq 2: +1500 до, -300 после добавления', () => {
    const rowOf = (j: StockEvent[]) => {
      const inv = j.find((e) => e.seq === 2)!;
      return stockLedger(j).find((r) => r.eventId === inv.id)!;
    };
    expect(rowOf(j12before()).implicit).toBeCloseTo(1500, 9);
    expect(rowOf([...j12before(), j12late()]).implicit).toBeCloseTo(-300, 9);
  });

  it('T-002 К13: asOf включителен — на момент рецепта 1450', () => {
    expect(stockBalance(j9(), at('13', '19:00'))).toBeCloseTo(1450, 9);
  });

  it('T-002 К13: asOf на миллисекунду раньше рецепта — рецепт не учтён (1700)', () => {
    expect(stockBalance(j9(), at('13', '18:59').replace(':00.000Z', ':59.999Z'))).toBeCloseTo(1700, 9);
  });

  it('T-002 К13: asOf раньше первого события — 0', () => {
    expect(stockBalance(j9(), at('12', '09:59').replace(':00.000Z', ':59.999Z'))).toBe(0);
    expect(stockBalance(j9(), '2020-01-01T00:00:00.000Z')).toBe(0);
  });

  it('T-002 К13: asOf сравнивается с occurredAt, а не с recordedAt', () => {
    // recordedAt у ev() в 2027: при сравнении по recordedAt ничего бы не попало в расчёт
    expect(stockBalance(j9(), '2026-10-12T10:00:00.000Z')).toBeCloseTo(1800, 9);
  });
});

// ---------- Лента ----------

describe('T-002 К14-К16: лента остатка', () => {
  it('T-002 К14: строки до/после/неявное приращение для журнала К11 (а)', () => {
    const j = j11a();
    const rows = stockLedger([nth(j, 3), nth(j, 1), nth(j, 0), nth(j, 2)]);
    expect(rows.map((r) => r.eventId)).toEqual(j.map((e) => e.id));
    const num = (x: number | null) => (x === null ? null : Math.round(x * 1e9) / 1e9);
    expect(rows.map((r) => [num(r.before), num(r.after)])).toEqual([[0, 1000], [1000, -500], [-500, 0], [0, 900]]);
    expect(nth(rows, 0).implicit).toBeNull();
    expect(nth(rows, 1).implicit).toBeNull();
    expect(nth(rows, 2).implicit).toBeCloseTo(500, 9);
    expect(nth(rows, 3).implicit).toBeNull();
  });

  it('T-002 К14: у инвентаризации, совпавшей с расчётным значением, неявное приращение 0, а не пусто', () => {
    const rows = stockLedger([ev('purchase', at('12', '10:00'), 1, 700), ev('inventory', at('12', '11:00'), 2, 700)]);
    expect(nth(rows, 1).implicit).toBe(0);
    expect(nth(rows, 0).implicit).toBeNull();
  });

  it('T-002 К14: инвентаризация первой в журнале — неявное приращение равно значению', () => {
    const rows = stockLedger([ev('inventory', at('12', '10:00'), 1, 400)]);
    expect(nth(rows, 0).before).toBe(0);
    expect(nth(rows, 0).after).toBe(400);
    expect(nth(rows, 0).implicit).toBeCloseTo(400, 9);
  });

  it('T-002 К14: лента пустого журнала пуста', () => {
    expect(stockLedger([])).toEqual([]);
  });

  it('T-002 К15: каждое изменение остатка объяснено событием на журналах К9-К12', () => {
    const journals: StockEvent[][] = [
      j9(), j10(), j11a(), j11b(), j11c(), j12before(), [...j12before(), j12late()],
      [ev('portion', at('12', '20:00'), 1, 100)],
    ];
    for (const j of journals) {
      const shuffled = [...j].reverse();
      const rows = stockLedger(shuffled);
      expect(rows).toHaveLength(j.length);
      expect(nth(rows, 0).before).toBe(0);
      rows.forEach((r, i) => {
        if (i > 0) expect(r.before).toBeCloseTo(nth(rows, i - 1).after, 9);
        const e = j.find((x) => x.id === r.eventId)!;
        if (e.kind in SIGN) expect(r.after - r.before).toBeCloseTo(SIGN[e.kind]! * e.quantity!, 9);
      });
      expect(nth(rows, rows.length - 1).after).toBeCloseTo(stockBalance(j), 9);
    }
  });

  it('T-002 К16: остаток и лента не изменяют журнал', () => {
    const j = deepFreeze([...j10()].reverse().concat(j11a()));
    const copy = structuredClone(j);
    stockBalance(j);
    stockBalance(j, at('12', '12:00'));
    stockLedger(j);
    expect(j).toEqual(copy);
    expect(j.map((e) => e.id)).toEqual(copy.map((e) => e.id));
  });
});

// ---------- Коэффициент и время ----------

describe('T-002 К17-К18: коэффициент и время', () => {
  it('T-002 К17: правка коэффициента позиции историю не переписывает', () => {
    const e1 = created(createStockEvent(buckwheat, { ...base, kind: 'purchase', packs: 2 }));
    const journal = [e1];
    expect(stockBalance(journal)).toBe(1800);

    const upd = updateProduct(buckwheat, { unitsPerPack: 800 });
    if (!upd.ok) throw new Error('тест: updateProduct упал');
    expect(upd.value.unitsPerPack).toBe(800);

    expect(stockBalance(journal)).toBe(1800);
    expect(e1.quantity).toBe(1800);
    expect(e1.unitsPerPack).toBe(900);

    const e2 = created(createStockEvent(upd.value, { ...base, id: 'e-2', seq: 2, occurredAt: '2026-10-13T09:00:00.000Z', kind: 'purchase', packs: 1 }));
    expect(e2.quantity).toBe(800);
    expect(stockBalance([e1, e2])).toBe(2600);
  });

  const badTimes = [
    '2026-10-12T09:00:00Z',
    '2026-10-12T12:00:00.000+03:00',
    '2026-10-12 09:00:00.000Z',
    '2026-02-30T09:00:00.000Z',
    '',
  ];
  for (const bad of badTimes) {
    it(`T-002 К18: occurredAt "${bad}" отклоняется`, () => {
      let r: unknown;
      expect(() => { r = createStockEvent(rice, { ...base, occurredAt: bad, kind: 'portion', quantity: 1 }); }).not.toThrow();
      expect(failedAttr(r)).toBe('occurredAt');
    });
    it(`T-002 К18: recordedAt "${bad}" отклоняется`, () => {
      let r: unknown;
      expect(() => { r = createStockEvent(rice, { ...base, recordedAt: bad, kind: 'portion', quantity: 1 }); }).not.toThrow();
      expect(failedAttr(r)).toBe('recordedAt');
    });
  }

  it('T-002 К18: канонический Instant принимается без изменений', () => {
    const e = created(createStockEvent(rice, { ...base, occurredAt: '2026-10-12T09:00:00.000Z', kind: 'portion', quantity: 1 }));
    expect(e.occurredAt).toBe('2026-10-12T09:00:00.000Z');
  });
});
