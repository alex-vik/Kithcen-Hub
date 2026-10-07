// T-005 К20–К25: запись события от клиента (BR-26, BR-02, BR-15, NFR-08, ADR-003 §5.3, §6, §8).
import { afterEach, describe, expect, it } from 'vitest';
import { stockBalance } from '../../../src/domain/journal.ts';
import { cleanup, count, mkProduct, nth, open, openFile, stock, tmpFile } from '../storage/helpers.ts';
import type { StorageApi } from '../storage/helpers.ts';
import { fakeClock, makeScenarios, v4 } from './helpers.ts';
import type { ClientInput } from './helpers.ts';

afterEach(cleanup);

const C1 = '2026-10-12T09:00:05.000Z';
const C2 = '2026-10-12T09:00:40.000Z';

function setup(now = C1) {
  const f = openFile();
  f.storage.addProduct(mkProduct('p-buckwheat', 'Гречка'));
  f.storage.addProduct(mkProduct('p-rice', 'Рис'));
  const clock = fakeClock(now);
  return { ...f, clock, app: makeScenarios(f.storage, clock) };
}
const portion = (id: string, over: Partial<ClientInput> = {}): ClientInput => ({
  id, productId: 'p-buckwheat', kind: 'portion', quantity: 100, occurredAt: '2026-10-12T12:00:00+03:00', source: 'kiosk', ...over,
});

describe('T-005 К20: новое событие от клиента', () => {
  it('T-005 К20: исход new, время приведено, recordedAt от часов, результат равен журналу', () => {
    const { app, storage, raw } = setup();
    const r = app.recordEvent(portion(v4(1)));
    expect(r.outcome).toBe('new');
    expect(count(raw, 'stock_event')).toBe(1);
    const rows = storage.listStockEvents('p-buckwheat');
    const row = nth(rows, 0);
    expect(row.occurredAt).toBe('2026-10-12T09:00:00.000Z');
    expect(row.recordedAt).toBe(C1);
    expect(row.quantity).toBe(100);
    expect(row.id).toBe(v4(1));
    if (r.outcome === 'new') expect(r.event).toStrictEqual(row);
  });

  it('T-005 К20: recordedAt не берётся из ввода клиента (NFR-08)', () => {
    const { app, storage } = setup();
    app.recordEvent({ ...portion(v4(1)), recordedAt: '2020-01-01T00:00:00.000Z', seq: 99 } as ClientInput);
    const row = nth(storage.listStockEvents('p-buckwheat'), 0);
    expect(row.recordedAt).toBe(C1);
    expect(row.seq).toBe(1);
  });

  it('T-005 К20 / BR-15: порция при нулевом остатке не отклоняется — минус допустим', () => {
    const { app, storage } = setup();
    expect(app.recordEvent(portion(v4(1))).outcome).toBe('new');
    expect(stockBalance(storage.listStockEvents('p-buckwheat'))).toBe(-100);
  });
});

describe('T-005 К21: повтор возвращает записанное', () => {
  it('T-005 К21: повтор порции с тем же текстом времени и с другой записью того же момента', () => {
    const { app, storage, clock, raw } = setup();
    const first = app.recordEvent(portion(v4(1)));
    clock.set(C2);
    for (const occurredAt of ['2026-10-12T12:00:00+03:00', '2026-10-12T09:00:00Z']) {
      const again = app.recordEvent(portion(v4(1), { occurredAt }));
      expect(again.outcome, occurredAt).toBe('repeat');
      if (again.outcome === 'repeat' && first.outcome === 'new') expect(again.event).toStrictEqual(first.event);
      if (again.outcome === 'repeat') expect(again.event.recordedAt).toBe(C1);
    }
    expect(count(raw, 'stock_event')).toBe(1);
    expect(nth(storage.listStockEvents('p-buckwheat'), 0).seq).toBe(1);
  });

  it('T-005 К21: повтор покупки 2 уп × 900', () => {
    const { app, clock, raw } = setup();
    const buy = (): ClientInput => ({
      id: v4(2), productId: 'p-buckwheat', kind: 'purchase', packs: 2, unitsPerPack: 900,
      occurredAt: '2026-10-12T10:00:00Z', source: 'kiosk',
    });
    expect(app.recordEvent(buy()).outcome).toBe('new');
    clock.set(C2);
    const again = app.recordEvent(buy());
    expect(again.outcome).toBe('repeat');
    if (again.outcome === 'repeat') expect(again.event.quantity).toBe(1800);
    expect(count(raw, 'stock_event')).toBe(1);
  });

  it('T-005 К21: двойное нажатие «отменить» — второй запрос с тем же id, targetId и временем нажатия даёт repeat', () => {
    const { app, clock, raw, storage } = setup();
    app.recordEvent(portion(v4(1)));
    const cancel = (): ClientInput => ({
      id: v4(3), productId: 'p-buckwheat', kind: 'cancel', targetId: v4(1),
      occurredAt: '2026-10-12T12:01:00+03:00', source: 'kiosk',
    });
    clock.set('2026-10-12T09:01:01.000Z');
    const first = app.recordEvent(cancel());
    expect(first.outcome).toBe('new');
    if (first.outcome === 'new') expect(first.event.occurredAt).toBe('2026-10-12T09:01:00.000Z');
    clock.set('2026-10-12T09:01:30.000Z');
    const second = app.recordEvent(cancel());
    expect(second.outcome).toBe('repeat');
    if (second.outcome === 'repeat') expect(second.event.recordedAt).toBe('2026-10-12T09:01:01.000Z');
    expect(count(raw, 'stock_event')).toBe(2);
    expect(stockBalance(storage.listStockEvents('p-buckwheat'))).toBe(0);
  });
});

describe('T-005 К22: повтор с другим содержимым — конфликт без перезаписи', () => {
  it('T-005 К22: инвентаризация 480 с id инвентаризации 500', () => {
    const { app, storage, clock, raw } = setup();
    const inv = (value: number): ClientInput => ({
      id: v4(4), productId: 'p-buckwheat', kind: 'inventory', value, occurredAt: '2026-10-12T09:00:00Z', source: 'kiosk',
    });
    app.recordEvent(inv(500));
    const before = storage.listStockEvents('p-buckwheat');
    clock.set(C2);
    const r = app.recordEvent(inv(480));
    expect(r.outcome).toBe('conflict');
    if (r.outcome === 'conflict') {
      expect(r.id).toBe(v4(4));
      expect(r.event.value).toBe(500);
    }
    expect(storage.listStockEvents('p-buckwheat')).toStrictEqual(before);
    expect(count(raw, 'stock_event')).toBe(1);
  });

  it('T-005 К22: порция с id записанной порции и другим количеством', () => {
    const { app, storage, raw } = setup();
    app.recordEvent(portion(v4(1)));
    const before = storage.listStockEvents('p-buckwheat');
    const r = app.recordEvent(portion(v4(1), { quantity: 150 }));
    expect(r.outcome).toBe('conflict');
    if (r.outcome === 'conflict') expect(r.id).toBe(v4(1));
    expect(storage.listStockEvents('p-buckwheat')).toStrictEqual(before);
    expect(count(raw, 'stock_event')).toBe(1);
  });
});

describe('T-005 К23: отказ без записи', () => {
  const cases: [string, Partial<ClientInput>, string][] = [
    ['порция с quantity 0', { quantity: 0 }, 'quantity'],
    ['неизвестная позиция', { productId: 'p-nope' }, 'productId'],
    ['время без смещения', { occurredAt: '2026-10-12T09:00:00' }, 'occurredAt'],
    ['id вида e-7', { id: 'e-7' }, 'id'],
    ['UUID v4 в верхнем регистре', { id: 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11' }, 'id'],
    ['UUID версии 5', { id: '886313e1-3b8a-5372-9b90-0c9aee199e5d' }, 'id'],
    ['UUID версии 1', { id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' }, 'id'],
    ['UUID v4 с вариантом c (не из 89ab)', { id: '00000000-0000-4000-c000-000000000001' }, 'id'],
    ['UUID v4 с вариантом 7 (не из 89ab)', { id: '00000000-0000-4000-7000-000000000001' }, 'id'],
    ['пустой id', { id: '' }, 'id'],
  ];
  for (const [name, over, attribute] of cases) {
    it(`T-005 К23: ${name} — отказ с атрибутом ${attribute}, журнал пуст`, () => {
      const { app, raw } = setup();
      const r = app.recordEvent(portion(v4(1), over));
      expect(r).toStrictEqual({ outcome: 'rejected', attribute });
      expect(count(raw, 'stock_event')).toBe(0);
    });
  }
  it('T-005 К23: настоящий UUID v4 в нижнем регистре принимается, в верхнем — нет', () => {
    const { app, raw } = setup();
    const id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    expect(app.recordEvent(portion(id.toUpperCase()))).toStrictEqual({ outcome: 'rejected', attribute: 'id' });
    expect(count(raw, 'stock_event')).toBe(0);
    expect(app.recordEvent(portion(id)).outcome).toBe('new');
  });
});

describe('T-005 К23: исключение хранилища не превращается в отказ', () => {
  it('T-005 К23: закрытая БД — recordEvent пробрасывает исключение', () => {
    const { app, storage } = setup();
    storage.close();
    expect(() => app.recordEvent(portion(v4(1)))).toThrow();
  });
});

describe('T-005 К24: отмена через сценарий', () => {
  function withEvents() {
    const s = setup();
    const p = mkProduct('p-buckwheat', 'Гречка');
    const r = mkProduct('p-rice', 'Рис');
    s.storage.addStockEvent(stock(p, v4(1), 'purchase', '2026-10-12T08:00:00.000Z', { quantity: 1800 }));
    s.storage.addStockEvent(stock(p, v4(2), 'portion', '2026-10-12T09:00:00.000Z', { quantity: 100 }));
    s.storage.addStockEvent(stock(r, v4(3), 'portion', '2026-10-12T09:00:00.000Z', { quantity: 50 }));
    s.clock.set('2026-10-12T10:00:00.000Z');
    return s;
  }
  const cancel = (id: number, targetId: string, productId = 'p-buckwheat'): ClientInput => ({
    id: v4(id), productId, kind: 'cancel', targetId, occurredAt: '2026-10-12T10:00:00Z', source: 'kiosk',
  });

  it('T-005 К24 (а): отмена E2 — new, остаток гречки 1800', () => {
    const { app, storage } = withEvents();
    expect(app.recordEvent(cancel(10, v4(2))).outcome).toBe('new');
    expect(stockBalance(storage.listStockEvents('p-buckwheat'))).toBe(1800);
  });

  it('T-005 К24 (б): отмена несуществующего id — отказ из-за ссылки, ничего не записано', () => {
    const { app, raw } = withEvents();
    const before = count(raw, 'stock_event');
    expect(app.recordEvent(cancel(10, v4(99)))).toStrictEqual({ outcome: 'rejected', attribute: 'targetId' });
    expect(count(raw, 'stock_event')).toBe(before);
  });

  it('T-005 К24 (в): отмена E3 (рис) с productId гречки — отказ из-за ссылки', () => {
    const { app, raw } = withEvents();
    const before = count(raw, 'stock_event');
    expect(app.recordEvent(cancel(10, v4(3)))).toStrictEqual({ outcome: 'rejected', attribute: 'targetId' });
    expect(count(raw, 'stock_event')).toBe(before);
  });

  it('T-005 К24 (г): id записанной порции E2 и несуществующий targetId — conflict, а не отказ по ссылке', () => {
    const { app, raw } = withEvents();
    const before = count(raw, 'stock_event');
    const r = app.recordEvent(cancel(2, v4(99)));
    expect(r.outcome).toBe('conflict');
    if (r.outcome === 'conflict') expect(r.id).toBe(v4(2));
    expect(count(raw, 'stock_event')).toBe(before);
  });
});

describe('T-005 К25: два повтора подряд дают одну строку', () => {
  it('T-005 К25: два вызова без await, затем новое открытие той же файловой БД', () => {
    const path = tmpFile();
    const s1: StorageApi = open({ path, busyTimeoutMs: 5000 });
    s1.addProduct(mkProduct('p-buckwheat', 'Гречка'));
    const app1 = makeScenarios(s1, fakeClock(C1));
    const outcomes = [app1.recordEvent(portion(v4(1))).outcome, app1.recordEvent(portion(v4(1))).outcome];
    s1.close();
    const s2: StorageApi = open({ path, busyTimeoutMs: 5000 });
    const app2 = makeScenarios(s2, fakeClock(C2));
    outcomes.push(app2.recordEvent(portion(v4(1))).outcome);
    expect(outcomes).toStrictEqual(['new', 'repeat', 'repeat']);
    expect(s2.listStockEvents('p-buckwheat')).toHaveLength(1);
    s2.close();
  });
});
