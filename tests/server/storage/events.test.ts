// T-004 К8–К14, К16: журналы остатка и состояний через хранилище (BR-01, BR-02, BR-15, BR-26, ADR-003 §3, §6, §7).
import { afterEach, describe, expect, it } from 'vitest';
import { isActive } from '../../../src/domain/catalog.ts';
import type { StateEvent } from '../../../src/domain/catalog.ts';
import { stockBalance, stockLedger } from '../../../src/domain/journal.ts';
import type { StockEvent } from '../../../src/domain/journal.ts';
import { added, at, cleanup, count, mkProduct, nth, openFile, state, stock, T0 } from './helpers.ts';

afterEach(cleanup);

describe('T-004 К8: событие неизвестной позиции не записывается', () => {
  it('T-004 К8: p-x нет в каталоге — отказ в обоих журналах, строк нет', () => {
    const { storage, raw } = openFile();
    const ghost = mkProduct('p-x', 'Призрак');
    expect(storage.addStockEvent(stock(ghost, 'e-1', 'portion', T0, { quantity: 100 }))).toStrictEqual({
      status: 'rejected',
      reason: 'unknown_product',
    });
    expect(storage.addStateEvent(state('p-x', 's-1', T0, 'inactive', 'user_button'))).toStrictEqual({
      status: 'rejected',
      reason: 'unknown_product',
    });
    expect(count(raw, 'stock_event')).toBe(0);
    expect(count(raw, 'state_event')).toBe(0);
    storage.close();
  });
});

describe('T-004 К9: событие читается в той же форме, в какой создано', () => {
  it('T-004 К9: все виды — toStrictEqual, у отсутствующих полей нет ключа, value 0 остаётся 0', () => {
    const { storage } = openFile();
    const p = mkProduct('p-buckwheat', 'Гречка');
    storage.addProduct(p);
    const base = stock(p, 'e-base', 'portion', '2026-10-12T08:00:00.000Z', { quantity: 10 });
    added(storage.addStockEvent(base));
    const events: StockEvent[] = [
      stock(p, 'e-1', 'portion', T0, { quantity: 100 }),
      stock(p, 'e-2', 'purchase', at('12', '10:00'), { packs: 2, unitsPerPack: 900 }),
      stock(p, 'e-3', 'purchase', at('12', '11:00'), { quantity: 450 }),
      stock(p, 'e-4', 'inventory', at('12', '12:00'), { value: 0 }),
      stock(p, 'e-5', 'inventory', at('12', '13:00'), { value: 480 }),
      stock(p, 'e-6', 'depleted', at('12', '14:00')),
      stock(p, 'e-7', 'cancel', at('12', '15:00'), { targetId: base.id }),
    ];
    expect(nth(events, 1).quantity).toBe(1800);
    for (const e of events) {
      const w = added(storage.addStockEvent(e));
      const expected = { ...e, seq: w.seq };
      expect(w, e.id).toStrictEqual(expected);
      expect(storage.getStockEvent(e.id), e.id).toStrictEqual(expected);
    }
    expect(storage.getStockEvent('e-4')?.value).toBe(0);
    expect(Object.keys(storage.getStockEvent('e-6') ?? {}).sort()).toEqual(
      ['id', 'kind', 'occurredAt', 'productId', 'recordedAt', 'seq', 'source'],
    );
    expect(storage.getStockEvent('e-nope')).toBeUndefined();
    storage.close();
  });
});

describe('T-004 К10: seq присваивает хранилище', () => {
  it('T-004 К10: целые, строго возрастают в порядке вставки, не зависят от occurredAt и переданного seq', () => {
    const { storage } = openFile();
    const a = mkProduct('p-a', 'А');
    const b = mkProduct('p-b', 'Б');
    storage.addProduct(a);
    storage.addProduct(b);
    const plan: Array<[typeof a, string, string, number]> = [
      [a, 'e-1', at('20', '10:00'), 500],
      [b, 'e-2', at('10', '10:00'), 7],
      [a, 'e-3', at('15', '10:00'), -3],
      [b, 'e-4', at('01', '10:00'), 7],
      [a, 'e-5', at('30', '10:00'), 0],
    ];
    const seqs = plan.map(([p, id, when, seq]) => added(storage.addStockEvent({ ...stock(p, id, 'portion', when, { quantity: 1 }), seq })).seq);
    for (const s of seqs) expect(Number.isInteger(s)).toBe(true);
    for (let i = 1; i < seqs.length; i++) expect(nth(seqs, i)).toBeGreaterThan(nth(seqs, i - 1));
    expect(storage.getStockEvent('e-5')?.seq).toBe(nth(seqs, 4));
    expect(storage.listStockEvents('p-a').map((e) => e.seq)).toEqual([nth(seqs, 2), nth(seqs, 0), nth(seqs, 4)]);
    storage.close();
  });
});

describe('T-004 К11: вставка «если такого id нет» (BR-26)', () => {
  it('T-004 К11: тот же id с тем же и с другим содержимым — дубля нет, отдаётся записанное', () => {
    const { storage, raw } = openFile();
    const p = mkProduct('p-buckwheat', 'Гречка');
    storage.addProduct(p);
    const first = added(storage.addStockEvent({ ...stock(p, 'X', 'portion', T0, { quantity: 100 }), recordedAt: '2026-10-12T09:00:05.000Z' }));
    // чтобы seq следующих записей отличался от исходного
    added(storage.addStockEvent(stock(p, 'Y', 'portion', at('12', '10:00'), { quantity: 1 })));

    const same = { ...stock(p, 'X', 'portion', T0, { quantity: 100 }), recordedAt: '2026-10-12T09:09:09.000Z' };
    const other = { ...stock(p, 'X', 'recipe', at('13', '10:00'), { quantity: 500 }), recordedAt: '2026-10-12T09:09:09.000Z' };
    for (const incoming of [same, other]) {
      const r = storage.addStockEvent(incoming);
      expect(r.status).toBe('exists');
      expect(r.status === 'exists' ? r.event : undefined).toStrictEqual(first);
      expect(count(raw, 'stock_event')).toBe(2);
      expect(storage.getStockEvent('X')).toStrictEqual(first);
    }
    expect(first.recordedAt).toBe('2026-10-12T09:00:05.000Z');
    storage.close();
  });
});

describe('T-004 К12: события позиции читаются в порядке (occurredAt, seq)', () => {
  it('T-004 К12: только события гречки; остаток 1650; неявное −300 у инвентаризации 1900', () => {
    const { storage } = openFile();
    const g = mkProduct('p-buckwheat', 'Гречка');
    const r = mkProduct('p-rice', 'Рис', 'г', 800);
    storage.addProduct(g);
    storage.addProduct(r);
    const w = (e: StockEvent) => added(storage.addStockEvent(e));
    w(stock(g, 'g-inv1', 'inventory', at('12', '09:00'), { value: 400 }));
    w(stock(g, 'g-inv2', 'inventory', at('13', '10:00'), { value: 1900 }));
    w(stock(g, 'g-recipe', 'recipe', at('13', '20:00'), { quantity: 250 }));
    w(stock(g, 'g-buy', 'purchase', at('12', '18:00'), { quantity: 1800 }));
    w(stock(r, 'r-1', 'portion', at('12', '12:00'), { quantity: 50 }));
    // равное occurredAt: id идёт против порядка вставки, recordedAt — против seq (порядок задаёт только seq)
    w(stock(g, 'g-tie-z-portion', 'portion', at('13', '20:00'), { quantity: 50, recordedAt: '2026-10-13T20:00:09.000Z' }));
    w(stock(r, 'r-2', 'purchase', at('13', '12:00'), { quantity: 800 }));
    w(stock(g, 'g-tie-a-purchase', 'purchase', at('13', '20:00'), { quantity: 50, recordedAt: '2026-10-13T20:00:01.000Z' }));

    const events = storage.listStockEvents(g.id);
    expect(events.map((e) => e.id)).toEqual(['g-inv1', 'g-buy', 'g-inv2', 'g-recipe', 'g-tie-z-portion', 'g-tie-a-purchase']);
    expect(stockBalance(events)).toBe(1650);
    const inv2 = stockLedger(events).find((row) => row.eventId === 'g-inv2');
    expect(inv2?.implicit).toBe(-300);
    expect(storage.listStockEvents(r.id).map((e) => e.id)).toEqual(['r-1', 'r-2']);
    expect(storage.listStockEvents('p-nope')).toEqual([]);
    storage.close();
  });
});

describe('T-004 К13: проверка ссылки отмены', () => {
  it('T-004 К13: (а) нет такого id, (б) другая позиция, (в) id события состояния, самоссылка — отказ; (г), (д) — записаны', () => {
    const { storage, raw } = openFile();
    const g = mkProduct('p-buckwheat', 'Гречка');
    const r = mkProduct('p-rice', 'Рис', 'г', 800);
    storage.addProduct(g);
    storage.addProduct(r);
    const e1 = added(storage.addStockEvent(stock(g, 'E1', 'portion', at('12', '09:00'), { quantity: 100 })));
    const e2 = added(storage.addStockEvent(stock(r, 'E2', 'portion', at('12', '09:00'), { quantity: 100 })));
    const s1 = added(storage.addStateEvent(state(g.id, 'S1', at('12', '09:00'), 'inactive', 'user_button')));

    const rejected = { status: 'rejected', reason: 'invalid_target' };
    const cancel = (id: string, target: string, p = g) => stock(p, id, 'cancel', at('12', '10:00'), { targetId: target });
    expect(storage.addStockEvent(cancel('c-a', 'nowhere')), 'а').toStrictEqual(rejected);
    expect(storage.addStockEvent(cancel('c-b', e2.id)), 'б').toStrictEqual(rejected);
    expect(storage.addStockEvent(cancel('c-b2', e1.id, r)), 'б зеркально').toStrictEqual(rejected);
    expect(storage.addStockEvent(cancel('c-v', s1.id)), 'в').toStrictEqual(rejected);
    expect(storage.addStockEvent({ ...cancel('c-self', 'x'), targetId: 'c-self' }), 'самоссылка').toStrictEqual(rejected);
    expect(count(raw, 'stock_event')).toBe(2);

    const c1 = added(storage.addStockEvent(cancel('c-g', e1.id)));
    const c2 = added(storage.addStockEvent(cancel('c-d', c1.id)));
    expect(c2.kind).toBe('cancel');

    const all = [...storage.listStockEvents(g.id), ...storage.listStockEvents(r.id)];
    const byId = new Map(all.map((e) => [e.id, e]));
    const cancels = all.filter((e) => e.kind === 'cancel');
    expect(cancels).toHaveLength(2);
    for (const c of cancels) {
      const target = byId.get(c.targetId ?? '');
      expect(target, c.id).toBeDefined();
      expect(target?.productId, c.id).toBe(c.productId);
      expect(target?.seq ?? Infinity, c.id).toBeLessThan(c.seq);
    }
    storage.close();
  });
});

describe('T-004 К14: минус не блокируется', () => {
  it('T-004 К14: порция −100 и рецепт −50 на пустой позиции записаны, остаток −150', () => {
    const { storage } = openFile();
    const p = mkProduct('p-buckwheat', 'Гречка');
    storage.addProduct(p);
    added(storage.addStockEvent(stock(p, 'e-1', 'portion', at('12', '09:00'), { quantity: 100 })));
    added(storage.addStockEvent(stock(p, 'e-2', 'recipe', at('12', '10:00'), { quantity: 50 })));
    expect(stockBalance(storage.listStockEvents(p.id))).toBe(-150);
    storage.close();
  });
});

describe('T-004 К16: журнал состояний — запись, чтение, повтор', () => {
  it('T-004 К16: порядок (occurredAt, seq), строгое равенство без refEventId, isActive = true, повтор id не дублирует', () => {
    const { storage, raw } = openFile();
    const p = mkProduct('p-kefir', 'Кефир', 'мл', 1000);
    storage.addProduct(p);
    // s1, s2 — равное occurredAt: id идёт против порядка вставки, recordedAt — против seq
    const s1 = state(p.id, 's-z', at('12', '10:00'), 'inactive', 'user_button', { recordedAt: '2026-10-12T10:00:09.000Z' });
    const s2 = state(p.id, 's-a', at('12', '10:00'), 'active', 'user_restore', { recordedAt: '2026-10-12T10:00:01.000Z' });
    const s3 = state(p.id, 's-m', at('11', '09:00'), 'inactive', 'auto_archive');
    const w1 = added(storage.addStateEvent(s1));
    const w2 = added(storage.addStateEvent(s2));
    const w3 = added(storage.addStateEvent(s3));
    expect(w1.seq).toBeLessThan(w2.seq);
    expect(w2.seq).toBeLessThan(w3.seq);

    const read = storage.listStateEvents(p.id);
    expect(read).toStrictEqual([{ ...s3, seq: w3.seq }, { ...s1, seq: w1.seq }, { ...s2, seq: w2.seq }] as StateEvent[]);
    for (const e of read) expect('refEventId' in e).toBe(false);
    expect(isActive(read)).toBe(true);

    const again = storage.addStateEvent({ ...s1, recordedAt: '2026-10-12T09:59:59.000Z', state: 'active' });
    expect(again.status).toBe('exists');
    expect(again.status === 'exists' ? again.event : undefined).toStrictEqual(w1);
    expect(count(raw, 'state_event')).toBe(3);
    storage.close();
  });

  it('T-004 К16: событие с refEventId читается с этим полем', () => {
    const { storage } = openFile();
    const p = mkProduct('p-kefir', 'Кефир', 'мл', 1000);
    storage.addProduct(p);
    const buy = added(storage.addStockEvent(stock(p, 'buy-1', 'purchase', at('12', '09:00'), { quantity: 1000 })));
    const s = state(p.id, 's-ref', at('12', '09:00'), 'active', 'purchase', { refEventId: buy.id });
    const w = added(storage.addStateEvent(s));
    expect(w).toStrictEqual({ ...s, seq: w.seq });
    expect(nth(storage.listStateEvents(p.id), 0)).toStrictEqual({ ...s, seq: w.seq });
    expect(nth(storage.listStateEvents(p.id), 0).refEventId).toBe('buy-1');
    storage.close();
  });
});
