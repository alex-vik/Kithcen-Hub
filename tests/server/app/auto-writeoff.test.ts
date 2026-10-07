// T-010 А1–А12: автосписание раз в сутки на поддельных часах (FR-CON-01, FR-CON-07, FR-CON-08, BR-27, BR-15, NFR-07).
import { afterEach, describe, expect, it } from 'vitest';
import { stockBalance } from '../../../src/domain/journal.ts';
import { derivedId } from '../../../src/server/app/ids.ts';
import { autos, cleanup, faulty, JOB, makeAuto, nth, runTicks, setup, totalEvents } from './auto-helpers.ts';
import type { Fault } from './auto-helpers.ts';
import { makeScenarios } from './helpers.ts';

afterEach(cleanup);

const NOW1 = '2026-10-07T10:00:00.000Z';
const END1 = '2026-10-07T21:00:00.000Z';
const key = (id: string, day: string): string => `auto_writeoff:${id}:${day}`;

describe('T-010 А1: первый запуск (Q-29)', () => {
  it('T-010 А1: ничего не списывается, processed пуст, курсор — вчера (2026-10-06)', async () => {
    const { storage, clock, raw } = setup(NOW1);
    const app = await makeAuto(storage, clock);
    expect(app.runPending()).toEqual({ processed: [] });
    expect(storage.lastJobDay(JOB)).toBe('2026-10-06');
    expect(totalEvents(raw)).toBe(0);
  });

  it('T-010 А1: «вчера» — по местной дате: 2026-10-06T22:30Z уже 2026-10-07 по Вильнюсу, курсор 2026-10-06', async () => {
    const { storage, clock } = setup('2026-10-06T22:30:00.000Z');
    const app = await makeAuto(storage, clock);
    expect(app.runPending().processed).toEqual([]);
    expect(storage.lastJobDay(JOB)).toBe('2026-10-06');
  });
});

describe('T-010 А2: первые сутки', () => {
  it('T-010 А2: два автосписания (p1=250, p2=1), id/occurredAt/recordedAt/source, курсор 2026-10-07', async () => {
    const { storage, clock } = setup(NOW1);
    const app = await makeAuto(storage, clock);
    app.runPending();
    clock.set(END1);
    expect(app.runPending().processed).toEqual(['2026-10-07']);
    for (const [id, q] of [['p1', 250], ['p2', 1]] as const) {
      const a = autos(storage, id);
      expect(a).toHaveLength(1);
      expect(nth(a, 0)).toMatchObject({
        id: derivedId(key(id, '2026-10-07')), quantity: q, occurredAt: '2026-10-06T21:00:00.000Z',
        recordedAt: END1, source: 'auto_writeoff', kind: 'auto_writeoff',
      });
    }
    expect(storage.lastJobDay(JOB)).toBe('2026-10-07');
  });

  it('T-010 А2 / А12: burst, без нормы и неактивная позиции не получили ни одного события', async () => {
    const { storage, clock, raw } = setup(NOW1);
    const app = await makeAuto(storage, clock);
    app.runPending();
    clock.set(END1);
    app.runPending();
    for (const id of ['pb', 'pn', 'pi']) expect(storage.listStockEvents(id), id).toEqual([]);
    expect(totalEvents(raw)).toBe(2);
  });
});

describe('T-010 А3: повторный запуск ничего не меняет (FR-CON-08)', () => {
  it('T-010 А3: тот же now и через 15 минут — processed пуст, событий и maxStockSeq столько же', async () => {
    const { storage, clock, raw } = setup(NOW1);
    const app = await makeAuto(storage, clock);
    app.runPending();
    clock.set(END1);
    app.runPending();
    const n = totalEvents(raw);
    const seq = storage.maxStockSeq();
    expect(n).toBe(2);
    expect(app.runPending().processed).toEqual([]);
    clock.set('2026-10-07T21:15:00.000Z');
    expect(app.runPending().processed).toEqual([]);
    expect(totalEvents(raw)).toBe(n);
    expect(storage.maxStockSeq()).toBe(seq);
  });
});

describe('T-010 А4: отставший курсор не дублирует', () => {
  it('T-010 А4: норма изменена, строка курсора удалена — сутки повторно в processed, событий нет, 250 остаётся', async () => {
    const { storage, clock, raw } = setup(NOW1);
    const app = await makeAuto(storage, clock);
    app.runPending();
    clock.set(END1);
    app.runPending();
    const p1 = storage.getProduct('p1');
    if (!p1) throw new Error('тест: нет p1');
    storage.editProduct({ ...p1, norm: 300 });
    raw.prepare('DELETE FROM job_runs WHERE job = ? AND day = ?').run(JOB, '2026-10-07');
    const n = totalEvents(raw);
    expect(app.runPending().processed).toEqual(['2026-10-07']);
    expect(totalEvents(raw)).toBe(n);
    expect(autos(storage, 'p1')).toHaveLength(1);
    expect(nth(autos(storage, 'p1'), 0).quantity).toBe(250);
    expect(storage.lastJobDay(JOB)).toBe('2026-10-07');
  });
});

describe('T-010 А5: отменённое автосписание не возвращается', () => {
  it('T-010 А5: после системной отмены и сброса курсора нового автосписания нет, остаток прежний', async () => {
    const { storage, clock, raw } = setup(NOW1);
    const app = await makeAuto(storage, clock);
    app.runPending();
    clock.set(END1);
    app.runPending();
    const id = derivedId(key('p1', '2026-10-07'));
    const cancel = makeScenarios(storage, clock).recordSystemBatch([
      { key: `absence_cancel:${id}`, productId: 'p1', kind: 'cancel', targetId: id, occurredAt: END1, source: 'system' },
    ]);
    expect(cancel.outcome).toBe('ok');
    raw.prepare('DELETE FROM job_runs WHERE job = ? AND day = ?').run(JOB, '2026-10-07');
    const before = stockBalance(storage.listStockEvents('p1'));
    const n = totalEvents(raw);
    expect(before).toBe(0);
    expect(app.runPending().processed).toEqual(['2026-10-07']);
    expect(autos(storage, 'p1')).toHaveLength(1);
    expect(totalEvents(raw)).toBe(n);
    expect(stockBalance(storage.listStockEvents('p1'))).toBe(before);
  });
});

describe('T-010 А6: догон после недельного простоя', () => {
  it('T-010 А6: семь суток по возрастанию, по одному автосписанию на сутки, seq растёт, p1 = −1750', async () => {
    const { storage, clock, raw } = setup('2026-10-07T22:00:00.000Z');
    storage.markJobDay(JOB, '2026-09-30');
    const app = await makeAuto(storage, clock);
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'];
    expect(app.runPending().processed).toEqual(days);
    for (const id of ['p1', 'p2']) {
      const a = autos(storage, id);
      expect(a.map((e) => e.id)).toEqual(days.map((d) => derivedId(key(id, d))));
      expect(a.map((e) => e.occurredAt)).toEqual([
        '2026-09-30T21:00:00.000Z', '2026-10-01T21:00:00.000Z', '2026-10-02T21:00:00.000Z', '2026-10-03T21:00:00.000Z',
        '2026-10-04T21:00:00.000Z', '2026-10-05T21:00:00.000Z', '2026-10-06T21:00:00.000Z',
      ]);
      const seqs = a.map((e) => e.seq);
      expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    }
    expect(stockBalance(storage.listStockEvents('p1'))).toBe(-1750);
    expect(stockBalance(storage.listStockEvents('p2'))).toBe(-7);
    expect(storage.lastJobDay(JOB)).toBe('2026-10-07');
    for (const id of ['pb', 'pn', 'pi']) expect(storage.listStockEvents(id), id).toEqual([]);
    expect(totalEvents(raw)).toBe(14);
  });

  it('T-010 А6: seq всех автосписаний растёт вместе с датой (сутки пишутся по порядку)', async () => {
    const { storage, clock } = setup('2026-10-07T22:00:00.000Z');
    storage.markJobDay(JOB, '2026-09-30');
    const app = await makeAuto(storage, clock);
    app.runPending();
    const all = [...autos(storage, 'p1'), ...autos(storage, 'p2')].sort((a, b) => a.seq - b.seq);
    const ats = all.map((e) => e.occurredAt);
    expect(ats).toEqual([...ats].sort());
  });
});

const SPRING_START = [
  '2026-03-26T22:00:00.000Z', '2026-03-27T22:00:00.000Z', '2026-03-28T22:00:00.000Z',
  '2026-03-29T21:00:00.000Z', '2026-03-30T21:00:00.000Z',
]; // начала суток 03-27 … 03-31 (03-29 — 23 часа)
const AUTUMN_START = [
  '2026-10-22T21:00:00.000Z', '2026-10-23T21:00:00.000Z', '2026-10-24T21:00:00.000Z',
  '2026-10-25T22:00:00.000Z', '2026-10-26T22:00:00.000Z',
]; // начала суток 10-23 … 10-27 (10-25 — 25 часов)

describe('T-010 А7–А9: переходы на летнее и зимнее время при тиках каждые 15 минут (BR-27)', () => {
  it('T-010 А7: весна — по одному автосписанию на каждые сутки 03-27…03-31, 03-29 записано на первом шаге ≥ 21:00Z', async () => {
    const { storage, clock } = setup('2026-03-27T00:00:00.000Z');
    storage.markJobDay(JOB, '2026-03-26');
    const app = await makeAuto(storage, clock);
    const first = await runTicks(app, clock, '2026-03-27T00:00:00.000Z', '2026-04-01T00:00:00.000Z');
    expect([...first.entries()]).toEqual([
      ['2026-03-27', '2026-03-27T22:00:00.000Z'],
      ['2026-03-28', '2026-03-28T22:00:00.000Z'],
      ['2026-03-29', '2026-03-29T21:00:00.000Z'],
      ['2026-03-30', '2026-03-30T21:00:00.000Z'],
      ['2026-03-31', '2026-03-31T21:00:00.000Z'],
    ]);
    for (const id of ['p1', 'p2']) expect(autos(storage, id).map((e) => e.occurredAt), id).toEqual(SPRING_START);
    expect(nth(autos(storage, 'p1'), 2).quantity).toBe(250);
  });

  it('T-010 А8: осень — сутки 10-23…10-27, 10-25 (25 часов) записано на первом шаге ≥ 22:00Z, одна норма', async () => {
    const { storage, clock } = setup('2026-10-23T00:00:00.000Z');
    storage.markJobDay(JOB, '2026-10-22');
    const app = await makeAuto(storage, clock);
    const first = await runTicks(app, clock, '2026-10-23T00:00:00.000Z', '2026-10-28T00:00:00.000Z');
    expect([...first.entries()]).toEqual([
      ['2026-10-23', '2026-10-23T21:00:00.000Z'],
      ['2026-10-24', '2026-10-24T21:00:00.000Z'],
      ['2026-10-25', '2026-10-25T22:00:00.000Z'],
      ['2026-10-26', '2026-10-26T22:00:00.000Z'],
      ['2026-10-27', '2026-10-27T22:00:00.000Z'],
    ]);
    for (const id of ['p1', 'p2']) expect(autos(storage, id).map((e) => e.occurredAt), id).toEqual(AUTUMN_START);
    expect(nth(autos(storage, 'p1'), 2).quantity).toBe(250);
  });

  // Допущение tester: конец диапазона тиков сдвинут на 4 ч, иначе при 03:30 последние сутки (03-31 / 10-27)
  // завершаются после конца диапазона А7/А8 и «число автосписаний как в А7 и А8» (пять) недостижимо.
  it('T-010 А9: 03:30 — весна: сутки 03-28 на первом шаге ≥ 2026-03-29T01:00Z; occurredAt по-прежнему 00:00 суток', async () => {
    const { storage, clock } = setup('2026-03-27T00:00:00.000Z');
    storage.markJobDay(JOB, '2026-03-26');
    const app = await makeAuto(storage, clock, { timeZone: 'Europe/Vilnius', autoWriteoffTime: '03:30' });
    const first = await runTicks(app, clock, '2026-03-27T00:00:00.000Z', '2026-04-01T04:00:00.000Z');
    expect([...first.entries()]).toEqual([
      ['2026-03-27', '2026-03-28T01:30:00.000Z'],
      ['2026-03-28', '2026-03-29T01:00:00.000Z'],
      ['2026-03-29', '2026-03-30T00:30:00.000Z'],
      ['2026-03-30', '2026-03-31T00:30:00.000Z'],
      ['2026-03-31', '2026-04-01T00:30:00.000Z'],
    ]);
    for (const id of ['p1', 'p2']) expect(autos(storage, id).map((e) => e.occurredAt), id).toEqual(SPRING_START);
  });

  it('T-010 А9: 03:30 — осень: сутки 10-24 на первом шаге ≥ 2026-10-25T00:30Z (первое вхождение, не 01:30)', async () => {
    const { storage, clock } = setup('2026-10-23T00:00:00.000Z');
    storage.markJobDay(JOB, '2026-10-22');
    const app = await makeAuto(storage, clock, { timeZone: 'Europe/Vilnius', autoWriteoffTime: '03:30' });
    const first = await runTicks(app, clock, '2026-10-23T00:00:00.000Z', '2026-10-28T04:00:00.000Z');
    expect([...first.entries()]).toEqual([
      ['2026-10-23', '2026-10-24T00:30:00.000Z'],
      ['2026-10-24', '2026-10-25T00:30:00.000Z'],
      ['2026-10-25', '2026-10-26T01:30:00.000Z'],
      ['2026-10-26', '2026-10-27T01:30:00.000Z'],
      ['2026-10-27', '2026-10-28T01:30:00.000Z'],
    ]);
    for (const id of ['p1', 'p2']) expect(autos(storage, id).map((e) => e.occurredAt), id).toEqual(AUTUMN_START);
  });
});

describe('T-010 А10–А11: атомарность суток (NFR-07, хвост ревью T-005)', () => {
  const FAIL_AT = '2026-10-05T21:00:00.000Z'; // начало суток 2026-10-06

  async function prepare(mode: Fault['mode']) {
    const s = setup(END1);
    s.storage.markJobDay(JOB, '2026-10-04');
    const fault: Fault = { mode, failAt: FAIL_AT };
    const wrapped = faulty(s.storage, fault);
    const app = await makeAuto(wrapped, s.clock);
    return { ...s, fault, app };
  }

  function expectDay5Only(s: Awaited<ReturnType<typeof prepare>>): void {
    const { storage, raw } = s;
    for (const id of ['p1', 'p2']) {
      expect(autos(storage, id).map((e) => e.occurredAt), id).toEqual(['2026-10-04T21:00:00.000Z']);
    }
    expect(totalEvents(raw)).toBe(2);
    expect(storage.lastJobDay(JOB)).toBe('2026-10-05');
  }

  it('T-010 А10: исключение на p2 за 10-06 — проброшено; 10-05 зафиксированы, 10-06 нет ни у одной позиции, 10-07 не тронуты', async () => {
    const s = await prepare('throw');
    expect(() => s.app.runPending()).toThrow('сбой хранилища (тест)');
    expectDay5Only(s);
  });

  it('T-010 А10: после исправления — processed [10-06, 10-07], без дублей за 10-05', async () => {
    const s = await prepare('throw');
    expect(() => s.app.runPending()).toThrow();
    s.fault.mode = 'off';
    expect(s.app.runPending().processed).toEqual(['2026-10-06', '2026-10-07']);
    for (const id of ['p1', 'p2']) {
      expect(autos(s.storage, id).map((e) => e.id), id).toEqual(
        ['2026-10-05', '2026-10-06', '2026-10-07'].map((d) => derivedId(key(id, d))),
      );
    }
    expect(s.storage.lastJobDay(JOB)).toBe('2026-10-07');
  });

  it('T-010 А11: отказ {rejected} внутри recordSystemBatch на p2 за 10-06 — исключение; откат и p1, и курсора за эти сутки', async () => {
    const s = await prepare('reject');
    expect(() => s.app.runPending()).toThrow();
    expectDay5Only(s);
  });

  it('T-010 А11: после исправления — [10-06, 10-07], без дублей', async () => {
    const s = await prepare('reject');
    expect(() => s.app.runPending()).toThrow();
    s.fault.mode = 'off';
    expect(s.app.runPending().processed).toEqual(['2026-10-06', '2026-10-07']);
    expect(autos(s.storage, 'p1')).toHaveLength(3);
    expect(autos(s.storage, 'p2')).toHaveLength(3);
  });
});

describe('T-011 С10: А11 — вставка p1 за сбойные сутки была до отказа на p2', () => {
  it('T-011 С10: addStockEvent по p1 за 2026-10-05T21:00Z вернул added раньше вызова по p2 за те же сутки', async () => {
    const FAIL_AT = '2026-10-05T21:00:00.000Z';
    const s = setup(END1);
    s.storage.markJobDay(JOB, '2026-10-04');
    const inner = faulty(s.storage, { mode: 'reject', failAt: FAIL_AT });
    const calls: { productId: string; status: string }[] = [];
    const spy = {
      ...inner,
      addStockEvent: (e: Parameters<typeof inner.addStockEvent>[0]) => {
        const r = inner.addStockEvent(e);
        if (e.occurredAt === FAIL_AT) calls.push({ productId: e.productId, status: r.status });
        return r;
      },
    };
    const app = await makeAuto(spy, s.clock);
    expect(() => app.runPending()).toThrow();
    expect(calls).toEqual([
      { productId: 'p1', status: 'added' },
      { productId: 'p2', status: 'rejected' },
    ]);
    expect(totalEvents(s.raw)).toBe(2);
    expect(s.storage.lastJobDay(JOB)).toBe('2026-10-05');
  });
});
