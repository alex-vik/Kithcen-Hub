// T-010 П1–П5: планировщик и прогрев кэша в конце тика (ADR-005, ADR-003a §4.4, §6.1, NFR-07).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCache, counted, expectMatchesReference } from '../app/balances-helpers.ts';
import type { Narrow } from '../app/balances-helpers.ts';
import { autos, cleanup, faulty, JOB, makeAuto, makeScheduler, setup, totalEvents } from '../app/auto-helpers.ts';
import type { Fault } from '../app/auto-helpers.ts';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

const MIN = 60_000;

/** Настоящие createAutoWriteoff и createBalanceCache над одной БД; кэш — на обёртке-счётчике listStockEvents. */
async function rig(startNow: string, cursor: string, fault?: Fault) {
  const s = setup(startNow);
  s.storage.markJobDay(JOB, cursor);
  const cnt = counted(s.storage as unknown as Narrow);
  const cache = await makeCache(cnt.storage);
  const seen: { inTx: boolean; cursor: string | undefined }[] = [];
  const failure = { warm: false };
  const warm = vi.fn(() => {
    seen.push({ inTx: s.storage.inTransaction(), cursor: s.storage.lastJobDay(JOB) });
    if (failure.warm) throw new Error('прогрев (тест)');
    cache.warm();
  });
  const log = vi.fn<(m: string, e: unknown) => void>();
  const autoWriteoff = await makeAuto(fault ? faulty(s.storage, fault) : s.storage, s.clock);
  const start = () => makeScheduler({ autoWriteoff, balances: { warm }, log, tickMinutes: 15 });
  return { ...s, cnt, cache, warm, log, seen, failure, start };
}

describe('T-010 П1: тик при старте и каждые N минут', () => {
  it('T-010 П1: старт — тик синхронно; следующий не раньше 15 минут; после stop() тиков нет', async () => {
    const r = await rig('2026-10-07T21:00:00.000Z', '2026-10-06');
    const sch = await r.start();
    // к возврату из startScheduler автосписания за 2026-10-07 уже записаны
    expect(autos(r.storage, 'p1').map((e) => e.occurredAt)).toEqual(['2026-10-06T21:00:00.000Z']);
    expect(r.warm).toHaveBeenCalledTimes(1);

    r.clock.set('2026-10-08T21:00:00.000Z'); // сутки 10-08 завершены
    vi.advanceTimersByTime(14 * MIN + 59_000);
    expect(autos(r.storage, 'p1')).toHaveLength(1);
    expect(r.warm).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(autos(r.storage, 'p1')).toHaveLength(2);
    expect(r.warm).toHaveBeenCalledTimes(2);

    sch.stop();
    r.clock.set('2026-10-09T21:00:00.000Z');
    vi.advanceTimersByTime(60 * MIN);
    expect(autos(r.storage, 'p1')).toHaveLength(2);
    expect(r.warm).toHaveBeenCalledTimes(2);
    expect(r.log).not.toHaveBeenCalled();
  });
});

describe('T-010 П2: прогрев в конце тика', () => {
  it('T-010 П2: после tick() cache.all() не читает журнал и совпадает со свёрткой', async () => {
    const r = await rig('2026-10-07T10:00:00.000Z', '2026-10-06');
    const sch = await r.start();
    r.clock.set('2026-10-07T21:00:00.000Z');
    sch.tick();
    expect(autos(r.storage, 'p1')).toHaveLength(1);
    r.cnt.reset();
    const all = r.cache.all();
    expect(r.cnt.calls).toEqual([]);
    expectMatchesReference(all, r.storage);
    expect(all.get('p1')).toBe(-250);
  });
});

describe('T-010 П3: один прогрев на догон', () => {
  it('T-010 П3: пять суток позади — warm ровно один раз, вне транзакции, курсор уже на последних сутках', async () => {
    const r = await rig('2026-10-02T12:00:00.000Z', '2026-10-02');
    const sch = await r.start();
    r.warm.mockClear();
    r.seen.length = 0;
    r.clock.set('2026-10-07T21:00:00.000Z');
    sch.tick();
    expect(r.warm).toHaveBeenCalledTimes(1);
    expect(r.seen).toEqual([{ inTx: false, cursor: '2026-10-07' }]);
    expect(autos(r.storage, 'p1')).toHaveLength(5);
  });
});

describe('T-010 П4: ошибка прогрева не прерывает тик (NFR-07)', () => {
  it('T-010 П4: warm бросает — tick не бросает, автосписания и курсор записаны, log один раз с этой ошибкой', async () => {
    const r = await rig('2026-10-07T10:00:00.000Z', '2026-10-06');
    const sch = await r.start();
    r.log.mockClear();
    r.failure.warm = true;
    r.clock.set('2026-10-07T21:00:00.000Z');
    expect(() => sch.tick()).not.toThrow();
    expect(autos(r.storage, 'p1')).toHaveLength(1);
    expect(r.storage.lastJobDay(JOB)).toBe('2026-10-07');
    expect(r.log).toHaveBeenCalledTimes(1);
    const [msg, err] = r.log.mock.calls[0] ?? [];
    expect(typeof msg).toBe('string');
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('прогрев (тест)');
  });

  it('T-010 П4: следующий tick с исправным warm штатный; all() совпадает со свёрткой', async () => {
    const r = await rig('2026-10-07T10:00:00.000Z', '2026-10-06');
    const sch = await r.start();
    r.failure.warm = true;
    r.clock.set('2026-10-07T21:00:00.000Z');
    sch.tick();
    r.failure.warm = false;
    r.log.mockClear();
    r.clock.set('2026-10-08T21:00:00.000Z');
    expect(() => sch.tick()).not.toThrow();
    expect(autos(r.storage, 'p1')).toHaveLength(2);
    expect(r.log).not.toHaveBeenCalled();
    r.cnt.reset();
    expectMatchesReference(r.cache.all(), r.storage);
    expect(r.cnt.calls).toEqual([]);
  });
});

describe('T-010 П5: ошибка суток не останавливает планировщик', () => {
  it('T-010 П5: сбой на сутках 10-06 — из таймера ничего не вылетает, log с ошибкой, warm вызван; следующий тик дообрабатывает', async () => {
    const fault: Fault = { mode: 'off', failAt: '2026-10-05T21:00:00.000Z' };
    const r = await rig('2026-10-04T12:00:00.000Z', '2026-10-04', fault);
    await r.start();
    r.warm.mockClear();
    r.seen.length = 0;
    fault.mode = 'throw';
    r.clock.set('2026-10-07T21:00:00.000Z');
    expect(() => vi.advanceTimersByTime(15 * MIN)).not.toThrow();
    expect(r.log).toHaveBeenCalledTimes(1);
    expect((r.log.mock.calls[0]?.[1] as Error).message).toBe('сбой хранилища (тест)');
    expect(r.warm).toHaveBeenCalledTimes(1);
    expect(r.seen).toEqual([{ inTx: false, cursor: '2026-10-05' }]);
    expect(autos(r.storage, 'p1')).toHaveLength(1);

    fault.mode = 'off';
    r.log.mockClear();
    vi.advanceTimersByTime(15 * MIN);
    expect(r.log).not.toHaveBeenCalled();
    expect(r.storage.lastJobDay(JOB)).toBe('2026-10-07');
    expect(autos(r.storage, 'p1')).toHaveLength(3);
    expect(totalEvents(r.raw)).toBe(6);
    expectMatchesReference(r.cache.all(), r.storage);
  });
});
