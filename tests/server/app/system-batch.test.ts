// T-005 К27–К28: пакетная запись системных событий (BR-26, ADR-003 §6, §8, ADR-005).
import { afterEach, describe, expect, it } from 'vitest';
import { stockBalance } from '../../../src/domain/journal.ts';
import { cleanup, count, mkProduct, nth, openFile } from '../storage/helpers.ts';
import { fakeClock, makeScenarios, NS_LITERAL, refV5 } from './helpers.ts';
import type { SystemItem } from './helpers.ts';

afterEach(cleanup);

const C1 = '2026-10-12T21:00:00.000Z';
const K1 = 'auto_writeoff:p-coffee:2026-10-12';
const K2 = 'auto_writeoff:p-coffee:2026-10-13';
const auto = (key: string, quantity = 20): SystemItem => ({
  key, productId: 'p-coffee', kind: 'auto_writeoff', quantity,
  occurredAt: key.endsWith('12') ? '2026-10-12T21:00:00.000Z' : '2026-10-13T21:00:00.000Z', source: 'system',
});

function setup() {
  const f = openFile();
  f.storage.addProduct(mkProduct('p-coffee', 'Кофе'));
  const clock = fakeClock(C1);
  return { ...f, clock, app: makeScenarios(f.storage, clock) };
}

describe('T-005 К27: повторный запуск пакета — «выполнено»', () => {
  it('T-005 К27: первый запуск — две строки, id = UUIDv5(NS, ключ), recordedAt от часов', () => {
    const { app, storage } = setup();
    const r = app.recordSystemBatch([auto(K1), auto(K2)]);
    expect(r.outcome).toBe('ok');
    if (r.outcome === 'ok') expect(r.items.map((i) => i.outcome)).toStrictEqual(['new', 'new']);
    const rows = storage.listStockEvents('p-coffee');
    expect(rows.map((e) => e.id)).toStrictEqual([refV5(NS_LITERAL, K1), refV5(NS_LITERAL, K2)]);
    expect(rows.every((e) => e.recordedAt === C1 && e.quantity === 20 && e.source === 'system')).toBe(true);
  });

  it('T-005 К27: второй запуск с −25 и третий после отмены первого — done, строк не прибавилось, −20 остаётся', () => {
    const { app, storage, clock, raw } = setup();
    app.recordSystemBatch([auto(K1), auto(K2)]);
    clock.set('2026-10-13T22:00:00.000Z');

    const second = app.recordSystemBatch([auto(K1, 25), auto(K2, 25)]);
    expect(second.outcome).toBe('ok');
    if (second.outcome === 'ok') {
      expect(second.items.map((i) => i.outcome)).toStrictEqual(['done', 'done']);
      expect(second.items.map((i) => i.event.quantity)).toStrictEqual([20, 20]);
    }
    expect(count(raw, 'stock_event')).toBe(2);

    // автосписание за 12.10 отменяется (системной отменой, время передаёт вызывающий), пакет запускается в третий раз
    const id1 = refV5(NS_LITERAL, K1);
    const cancel = app.recordSystemBatch([
      { key: `absence_cancel:${id1}`, productId: 'p-coffee', kind: 'cancel', targetId: id1,
        occurredAt: '2026-10-13T22:00:00.000Z', source: 'system' },
    ]);
    expect(cancel.outcome).toBe('ok');
    const rowsBefore = storage.listStockEvents('p-coffee');
    expect(rowsBefore).toHaveLength(3);

    const third = app.recordSystemBatch([auto(K1, 25), auto(K2, 25)]);
    expect(third.outcome).toBe('ok');
    if (third.outcome === 'ok') expect(third.items.map((i) => i.outcome)).toStrictEqual(['done', 'done']);
    expect(storage.listStockEvents('p-coffee')).toStrictEqual(rowsBefore);
    expect(stockBalance(rowsBefore)).toBe(-20);
    expect(nth(rowsBefore, 0).quantity).toBe(20);
  });
});

describe('T-005 К28: пакет атомарен', () => {
  it('T-005 К28 (а): третий элемент — неизвестная позиция: отказ с номером элемента, журнал пуст', () => {
    const { app, raw } = setup();
    const r = app.recordSystemBatch([
      auto(K1), auto(K2), { ...auto('auto_writeoff:p-nope:2026-10-12'), productId: 'p-nope' },
    ]);
    expect(r).toMatchObject({ outcome: 'rejected', index: 2, attribute: 'productId' });
    expect(count(raw, 'stock_event')).toBe(0);
  });

  it('T-005 К28 (б): третий — отмена несуществующего события: отказ с номером элемента, журнал пуст', () => {
    const { app, raw } = setup();
    const r = app.recordSystemBatch([
      auto(K1), auto(K2),
      { key: 'absence_cancel:nope', productId: 'p-coffee', kind: 'cancel', targetId: 'no-such-event',
        occurredAt: C1, source: 'system' },
    ]);
    expect(r).toMatchObject({ outcome: 'rejected', index: 2, attribute: 'targetId' });
    expect(count(raw, 'stock_event')).toBe(0);
  });

  it('T-005 К28 (в): автосписание и его отмена в одном пакете — обе строки, остаток 0', () => {
    const { app, storage, raw } = setup();
    const id1 = refV5(NS_LITERAL, K1);
    const r = app.recordSystemBatch([
      auto(K1),
      { key: `absence_cancel:${id1}`, productId: 'p-coffee', kind: 'cancel', targetId: id1,
        occurredAt: '2026-10-12T21:00:01.000Z', source: 'system' },
    ]);
    expect(r.outcome).toBe('ok');
    expect(count(raw, 'stock_event')).toBe(2);
    expect(stockBalance(storage.listStockEvents('p-coffee'))).toBe(0);
  });

  it('T-005 К28: после отказа пакета тот же пакет без плохого элемента записывается (нет остаточного состояния)', () => {
    const { app, raw } = setup();
    app.recordSystemBatch([auto(K1), { ...auto(K2), productId: 'p-nope' }]);
    expect(count(raw, 'stock_event')).toBe(0);
    const r = app.recordSystemBatch([auto(K1), auto(K2)]);
    expect(r.outcome).toBe('ok');
    if (r.outcome === 'ok') expect(r.items.map((i) => i.outcome)).toStrictEqual(['new', 'new']);
    expect(count(raw, 'stock_event')).toBe(2);
  });
});
