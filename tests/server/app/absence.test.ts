// T-012 О1–О13: запись отпуска, пропуск суток планировщиком, ретро-отмена автосписаний
// (FR-ABS-01…04, BR-02, BR-26, BR-27, BR-15, NFR-07, ADR-003 пример 3, ADR-003a §5, ADR-005).
import { afterEach, describe, expect, it } from 'vitest';
import { stockLedger } from '../../../src/domain/journal.ts';
import { dayBounds } from '../../../src/domain/time.ts';
import { derivedId } from '../../../src/server/app/ids.ts';
import { cleanup, mkProduct, nth, openFile } from '../storage/helpers.ts';
import type { StockEvent } from '../../../src/domain/journal.ts';
import { addMinutes, runTicks, totalEvents } from './auto-helpers.ts';
import {
  absCancels, allAbsCancels, autoOf, balance, effectiveAutos, example3, JOB, jobDays, loc, makeAbsence, periodRows, scene, v4,
} from './absence-helpers.ts';
import type { AbsStorage, Scene } from './absence-helpers.ts';
import { createBalanceCache } from '../../../src/server/app/balances.ts';
import { expectMatchesReference } from './balances-helpers.ts';
import type { Narrow } from './balances-helpers.ts';

afterEach(cleanup);

const ID = v4(100);
const REQ = { id: ID, start: '2026-10-10', end: '2026-10-13' };
const startOf = (d: string): string => dayBounds(d, 'Europe/Vilnius').start;
const key = (t: string): string => `absence_cancel:${t}`;
const DAYS4 = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];

describe('T-012 О1: ретро-отпуск после инвентаризации — пример 3 ADR-003 (FR-ABS-04)', () => {
  it('T-012 О1: new, cancelled = 8; у P четыре отмены на автосписания 10-10…10-13 с id, occurredAt = recordedAt = now', async () => {
    const s = await example3();
    const now = s.clock.now();
    const r = s.abs.recordAbsence(REQ);
    expect(r).toMatchObject({ outcome: 'new', cancelled: 8, period: { id: ID, start: '2026-10-10', end: '2026-10-13', recordedAt: now } });
    const cs = absCancels(s.storage, 'P');
    expect(cs).toHaveLength(4);
    const targets = DAYS4.map((d) => nth(autoOf(s.storage, 'P').filter((e) => e.occurredAt === startOf(d)), 0).id);
    expect(cs.map((c) => c.targetId)).toEqual(targets);
    for (const c of cs) {
      expect(c).toMatchObject({
        id: derivedId(key(c.targetId ?? '')), productId: 'P', kind: 'cancel', source: 'absence', occurredAt: now, recordedAt: now,
      });
    }
    expect(absCancels(s.storage, 'Q')).toHaveLength(4);
    expect(allAbsCancels(s.raw)).toBe(8);
  });

  it('T-012 О1: остаток P = 460 до и после; implicit инвентаризации 480 был +80, стал 0', async () => {
    const s = await example3();
    const implicit = (): number | null => {
      const evs = s.storage.listStockEvents('P');
      const row = stockLedger(evs).find((x) => x.eventId === v4(2));
      return row === undefined ? NaN : row.implicit;
    };
    expect(balance(s.storage, 'P')).toBe(460);
    expect(implicit()).toBe(80);
    s.abs.recordAbsence(REQ);
    expect(balance(s.storage, 'P')).toBe(460);
    expect(implicit()).toBe(0);
  });

  it('T-012 О1: отпуск записан в listAbsencePeriods', async () => {
    const s = await example3();
    const now = s.clock.now();
    s.abs.recordAbsence(REQ);
    expect(s.storage.listAbsencePeriods()).toEqual([{ id: ID, start: '2026-10-10', end: '2026-10-13', recordedAt: now }]);
  });
});

describe('T-012 О2: без инвентаризации остаток возвращается (BR-15, пример 3 без seq 7)', () => {
  it('T-012 О2: P: 380 до записи отпуска, 460 после', async () => {
    const s = await example3(false);
    expect(balance(s.storage, 'P')).toBe(380);
    s.abs.recordAbsence(REQ);
    expect(balance(s.storage, 'P')).toBe(460);
    expect(balance(s.storage, 'Q')).toBe(-6 + 4); // Q: 6 автосписаний по 1, четыре отменены; минус не ошибка
  });
});

describe('T-012 О3: отпуск заранее — планировщик пропускает сутки (FR-ABS-02, FR-ABS-03)', () => {
  it('T-012 О3: автосписания за 10-09 и 10-14 есть, за 10-10…10-13 нет; курсор 10-14; job_runs за все сутки', async () => {
    const s = await scene(loc('2026-10-08', '12:00'), '2026-10-08');
    expect(s.abs.recordAbsence(REQ)).toMatchObject({ outcome: 'new', cancelled: 0 });
    await runTicks(s.auto, s.clock, loc('2026-10-08', '12:00'), loc('2026-10-15', '00:30'));
    for (const id of ['P', 'Q']) {
      expect(autoOf(s.storage, id).map((e) => e.occurredAt), id).toEqual([startOf('2026-10-09'), startOf('2026-10-14')]);
    }
    expect(s.storage.lastJobDay(JOB)).toBe('2026-10-14');
    expect(jobDays(s.raw).filter((d) => d > '2026-10-08')).toEqual(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
    expect(allAbsCancels(s.raw)).toBe(0);
  });
});

describe('T-012 О4: отпуск начался до записи и ещё идёт', () => {
  it('T-012 О4: cancelled = 4; за 10-12…10-14 автосписаний нет, за 10-15 есть', async () => {
    const s = await scene(loc('2026-10-12', '00:30'), '2026-10-08');
    expect(s.auto.runPending().processed).toEqual(['2026-10-09', '2026-10-10', '2026-10-11']);
    s.clock.set(loc('2026-10-12', '10:00'));
    expect(s.abs.recordAbsence({ id: ID, start: '2026-10-10', end: '2026-10-14' })).toMatchObject({ outcome: 'new', cancelled: 4 });
    await runTicks(s.auto, s.clock, loc('2026-10-12', '10:00'), loc('2026-10-16', '00:30'));
    for (const id of ['P', 'Q']) {
      expect(autoOf(s.storage, id).map((e) => e.occurredAt), id)
        .toEqual(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-15'].map(startOf));
    }
    expect(effectiveAutos(s.storage)).toEqual(['P', 'Q'].flatMap((id) => ['2026-10-09', '2026-10-15'].map((d) => `${id}@${startOf(d)}`)).sort());
  });
});

describe('T-012 О5: простой сервера во время отпуска — несписанные сутки не досписываются', () => {
  async function prepared(): Promise<Scene> {
    const s = await scene(loc('2026-10-10', '00:30'), '2026-10-08');
    expect(s.auto.runPending().processed).toEqual(['2026-10-09']);
    s.clock.set(loc('2026-10-16', '10:00'));
    return s;
  }

  it('T-012 О5: recordAbsence, затем runPending — cancelled = 0, автосписаний за 10-10…10-13 нет, за 10-14, 10-15 есть, курсор 10-15', async () => {
    const s = await prepared();
    expect(s.abs.recordAbsence(REQ)).toMatchObject({ outcome: 'new', cancelled: 0 });
    s.auto.runPending();
    for (const id of ['P', 'Q']) {
      expect(autoOf(s.storage, id).map((e) => e.occurredAt), id).toEqual(['2026-10-09', '2026-10-14', '2026-10-15'].map(startOf));
    }
    expect(s.storage.lastJobDay(JOB)).toBe('2026-10-15');
  });

  it('T-012 О5: обратный порядок даёт те же остатки и действующие автосписания, но с парами «автосписание + отмена»', async () => {
    const a = await prepared();
    a.abs.recordAbsence(REQ);
    a.auto.runPending();
    const b = await prepared();
    b.auto.runPending();
    expect(autoOf(b.storage, 'P')).toHaveLength(7);
    expect(b.abs.recordAbsence(REQ)).toMatchObject({ outcome: 'new', cancelled: 8 });
    expect(allAbsCancels(b.raw)).toBe(8);
    expect(effectiveAutos(b.storage)).toEqual(effectiveAutos(a.storage));
    expect(effectiveAutos(a.storage)).toHaveLength(6);
    for (const id of ['P', 'Q']) expect(balance(b.storage, id), id).toBe(balance(a.storage, id));
    expect(balance(a.storage, 'P')).toBe(-60);
  });
});

describe('T-012 О6–О8: повтор, конфликт, пересечение (BR-26, ADR-005)', () => {
  it('T-012 О6: тот же id и даты — repeat, cancelled = 0, журнал и maxStockSeq без изменений, один период', async () => {
    const s = await example3();
    const recordedAt = s.clock.now();
    s.abs.recordAbsence(REQ);
    const n = totalEvents(s.raw);
    const seq = s.storage.maxStockSeq();
    s.clock.set(addMinutes(s.clock.now(), 1));
    expect(s.abs.recordAbsence(REQ)).toMatchObject({ outcome: 'repeat', cancelled: 0 });
    s.clock.set(addMinutes(s.clock.now(), 1));
    const third = s.abs.recordAbsence(REQ);
    expect(third).toMatchObject({ outcome: 'repeat', cancelled: 0, period: { id: ID, start: '2026-10-10', end: '2026-10-13', recordedAt } });
    expect(totalEvents(s.raw)).toBe(n);
    expect(s.storage.maxStockSeq()).toBe(seq);
    expect(s.storage.listAbsencePeriods()).toHaveLength(1);
  });

  it('T-012 О7: тот же id, другие даты — conflict с записанным периодом; ничего не изменилось; автосписание 10-14 действует', async () => {
    const s = await example3();
    const first = s.abs.recordAbsence(REQ);
    const n = totalEvents(s.raw);
    const r = s.abs.recordAbsence({ id: ID, start: '2026-10-10', end: '2026-10-14' });
    expect(r).toMatchObject({ outcome: 'conflict', period: { id: ID, start: '2026-10-10', end: '2026-10-13' } });
    expect(first.outcome).toBe('new');
    expect(totalEvents(s.raw)).toBe(n);
    expect(periodRows(s.raw)).toBe(1);
    expect(effectiveAutos(s.storage)).toContain(`P@${startOf('2026-10-14')}`);
  });

  it('T-012 О7: тот же id и end, другой start — conflict (сравниваются обе даты); ничего не изменилось', async () => {
    const s = await example3();
    s.abs.recordAbsence(REQ);
    const n = totalEvents(s.raw);
    const r = s.abs.recordAbsence({ id: ID, start: '2026-10-11', end: '2026-10-13' });
    expect(r).toMatchObject({ outcome: 'conflict', period: { id: ID, start: '2026-10-10', end: '2026-10-13' } });
    expect(totalEvents(s.raw)).toBe(n);
    expect(periodRows(s.raw)).toBe(1);
  });

  it('T-012 О8: пересекающийся период с новым id — new, cancelled = 2 (P и Q за 10-14); у каждого автосписания периода ровно одна отмена', async () => {
    const s = await example3();
    s.abs.recordAbsence(REQ);
    const r = s.abs.recordAbsence({ id: v4(101), start: '2026-10-12', end: '2026-10-14' });
    expect(r).toMatchObject({ outcome: 'new', cancelled: 2 });
    expect(s.storage.listAbsencePeriods()).toHaveLength(2);
    for (const id of ['P', 'Q']) {
      const cs = absCancels(s.storage, id);
      expect(cs, id).toHaveLength(5);
      for (const d of [...DAYS4, '2026-10-14']) {
        const target = nth(autoOf(s.storage, id).filter((e) => e.occurredAt === startOf(d)), 0).id;
        expect(cs.filter((c) => c.targetId === target), `${id} ${d}`).toHaveLength(1);
      }
    }
  });
});

describe('T-012 О8а: отменённая отмена отпуска и новый период (хвост ревью)', () => {
  it('T-012 О8а: cancel на отмену P/10-12, затем период 10-12…10-14 — cancelled = 2 (только новые), P/10-12 остаётся действующим', async () => {
    const s = await example3();
    s.abs.recordAbsence(REQ);
    const target = nth(autoOf(s.storage, 'P').filter((e) => e.occurredAt === startOf('2026-10-12')), 0).id;
    const absCancel = nth(absCancels(s.storage, 'P').filter((c) => c.targetId === target), 0);
    const undo = s.write.recordEvent({ id: v4(102), productId: 'P', kind: 'cancel', occurredAt: s.clock.now(), source: 'user', targetId: absCancel.id });
    expect(undo.outcome).toBe('new');
    const live = (d: string): boolean => {
      const evs = s.storage.listStockEvents('P');
      const dead = new Set(evs.filter((e) => e.kind === 'cancel').map((e) => e.targetId));
      const a = nth(evs.filter((e) => e.kind === 'auto_writeoff' && e.occurredAt === startOf(d)), 0);
      return !evs.some((e) => e.kind === 'cancel' && e.targetId === a.id && !dead.has(e.id));
    };
    expect(live('2026-10-12')).toBe(true);

    const r = s.abs.recordAbsence({ id: v4(103), start: '2026-10-12', end: '2026-10-14' });
    expect(r).toMatchObject({ outcome: 'new', cancelled: 2 });
    expect(live('2026-10-12')).toBe(true);
    expect(live('2026-10-14')).toBe(false);
    expect(absCancels(s.storage, 'P').filter((c) => c.targetId === target)).toHaveLength(1);
  });
});

describe('T-012 О9: затрагиваются только автосписания', () => {
  it('T-012 О9: порция, покупка, порча и уже отменённое автосписание не получают отмен отпуска', async () => {
    const s = await scene(loc('2026-10-15', '09:00'), '2026-10-08');
    s.auto.runPending();
    const put = (n: number, productId: string, kind: string, at: string, quantity: number): StockEvent => {
      const r = s.write.recordEvent({ id: v4(n), productId, kind, occurredAt: at, source: 'test', quantity });
      if (r.outcome !== 'new') throw new Error(`тест: не записано ${kind}: ${JSON.stringify(r)}`);
      return r.event;
    };
    const others = [
      put(1, 'P', 'portion', loc('2026-10-11', '12:00'), 5),
      put(2, 'B', 'purchase', loc('2026-10-11', '10:00'), 300),
      put(3, 'B', 'spoilage', loc('2026-10-12', '10:00'), 50),
    ];
    const mine = nth(autoOf(s.storage, 'P').filter((e) => e.occurredAt === startOf('2026-10-12')), 0);
    const userCancel = s.write.recordEvent({ id: v4(4), productId: 'P', kind: 'cancel', occurredAt: loc('2026-10-15', '09:00'), source: 'user', targetId: mine.id });
    expect(userCancel.outcome).toBe('new');

    expect(s.abs.recordAbsence(REQ)).toMatchObject({ outcome: 'new', cancelled: 7 });
    const targets = ['P', 'Q', 'B'].flatMap((id) => absCancels(s.storage, id)).map((c) => c.targetId);
    for (const o of others) expect(targets).not.toContain(o.id);
    expect(targets).not.toContain(mine.id);
    expect(targets).toHaveLength(7);
    const refs = s.storage.listStockEvents('P').filter((e) => e.kind === 'cancel' && e.targetId === mine.id);
    expect(refs.map((e) => e.source)).toEqual(['user']);
  });
});

describe('T-012 О10: отказ ввода — ничего не пишется', () => {
  it.each([
    ['id v5', { ...REQ, id: derivedId('x') }, 'id'],
    ['id в верхнем регистре', { ...REQ, id: 'abcdef01-0000-4000-8000-00000000000a'.toUpperCase() }, 'id'],
    ['id не строка', { ...REQ, id: 12345 }, 'id'],
    ['start > end', { id: ID, start: '2026-10-13', end: '2026-10-10' }, 'end'],
    ['start не дата', { id: ID, start: 'x', end: '2026-10-13' }, 'start'],
  ])('T-012 О10: %s → rejected %s, журнал и absence_period не изменились', async (_n, input, attribute) => {
    const s = await example3();
    const n = totalEvents(s.raw);
    expect(s.abs.recordAbsence(input)).toEqual({ outcome: 'rejected', attribute });
    expect(totalEvents(s.raw)).toBe(n);
    expect(periodRows(s.raw)).toBe(0);
  });
});

describe('T-012 О11: атомарность — отказ пакета отмен', () => {
  function wrap(storage: AbsStorage, mode: { on: boolean }) {
    const log: string[] = [];
    let n = 0;
    const wrapped = {
      ...storage,
      addStockEvent: (e: StockEvent) => {
        if (mode.on && e.kind === 'cancel' && e.source === 'absence') {
          if (++n === 2) { log.push('rejected'); return { status: 'rejected' as const, reason: 'invalid_target' as const }; }
          const r = storage.addStockEvent(e);
          log.push(r.status);
          return r;
        }
        return storage.addStockEvent(e);
      },
    } as AbsStorage;
    return { wrapped, log, reset: () => { n = 0; log.length = 0; } };
  }

  it('T-012 О11: исключение проброшено; периода, отмен отпуска и сдвига остатка нет; первая отмена была вставлена до отказа', async () => {
    const s = await example3();
    const mode = { on: true };
    const w = wrap(s.storage, mode);
    const abs = await makeAbsence(w.wrapped, s.clock);
    const before = balance(s.storage, 'P');
    const n = totalEvents(s.raw);
    expect(() => abs.recordAbsence(REQ)).toThrow();
    expect(w.log).toEqual(['added', 'rejected']);
    expect(s.storage.listAbsencePeriods()).toEqual([]);
    expect(periodRows(s.raw)).toBe(0);
    expect(allAbsCancels(s.raw)).toBe(0);
    expect(totalEvents(s.raw)).toBe(n);
    expect(balance(s.storage, 'P')).toBe(before);
    expect(s.storage.inTransaction()).toBe(false);

    mode.on = false;
    expect(abs.recordAbsence(REQ)).toMatchObject({ outcome: 'new', cancelled: 8 });
  });
});

describe('T-012 О12: авто-откат SQLite внутри сценария — ошибка не перехватывается (хвост T-011 НВ-1)', () => {
  const variants: [string, string, RegExp][] = [
    ['а: на absence_period', "CREATE TRIGGER boom BEFORE INSERT ON absence_period BEGIN SELECT RAISE(ROLLBACK, 'boom-a'); END", /boom-a/],
    ['б: на второй отмене отпуска в stock_event',
      "CREATE TRIGGER boom BEFORE INSERT ON stock_event WHEN NEW.kind = 'cancel' AND NEW.source = 'absence' " +
      "AND (SELECT COUNT(*) FROM stock_event WHERE kind = 'cancel' AND source = 'absence') >= 1 BEGIN SELECT RAISE(ROLLBACK, 'boom-b'); END",
      /boom-b/],
  ];
  it.each(variants)('T-012 О12 %s', async (_n, trigger, message) => {
    const s = await example3();
    s.raw.exec(trigger);
    expect(() => s.abs.recordAbsence(REQ)).toThrow(message);
    expect(periodRows(s.raw)).toBe(0);
    expect(allAbsCancels(s.raw)).toBe(0);
    expect(s.storage.inTransaction()).toBe(false);

    s.raw.exec('DROP TRIGGER boom');
    expect(s.abs.recordAbsence(REQ)).toMatchObject({ outcome: 'new', cancelled: 8 });

    // после авто-отката хранилище не осталось в автокоммите: откат вложенной вставки работает
    const z = mkProduct('zz', 'ZZ');
    expect(() => s.storage.transaction(() => {
      s.storage.addProduct(z);
      throw new Error('после одной вставки');
    })).toThrow('после одной вставки');
    expect(s.storage.getProduct('zz')).toBeUndefined();
  });
});

describe('T-012 О13: кэш остатков видит ретро-отпуск (ADR-003a)', () => {
  it('T-012 О13: прогретый кэш: balance(P) 380 → 460, all() совпадает со свёрткой', async () => {
    const s = await example3(false);
    const cache = createBalanceCache({ storage: s.storage as unknown as Narrow as never });
    cache.warm();
    expect(cache.balance('P')).toBe(380);
    s.abs.recordAbsence(REQ);
    expect(cache.balance('P')).toBe(460);
    expectMatchesReference(cache.all(), s.storage);
  });
});
