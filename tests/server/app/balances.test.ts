// T-009 К17-кэш.1–10, К17-прогрев.11–13, Ш1–Ш4: кэш остатков со знаком seq (ADR-003a §4, §6.1; BR-01, BR-02, BR-15, NFR-07).
// Журнал К16 (T-008) 20 тыс. событий во временной файловой БД; одна БД на файл, шаги идут последовательно.
// Эталон — stockBalance(listStockEvents(id)) по каждой позиции listProducts(); сравнение toBe.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stockBalance } from '../../../src/domain/journal.ts';
import { PERF } from '../../perf/config.ts';
import { fakeClock, makeScenarios } from './helpers.ts';
import {
  counted, createDb, expectMatchesReference, HOUR, lastValueEvent, makeCache, nth, openSecond, put, reference, shift,
  withValueEvent,
} from './balances-helpers.ts';
import type { BalanceCache, Db, Narrow } from './balances-helpers.ts';
import { mkProduct, T0 } from '../storage/helpers.ts';

const SLOW = 120_000;
let db: Db;
let cands: string[];
let nextCand = 0;
/** Следующая позиция с действующим значением-событием; каждая позиция берётся один раз. */
const take = (n = 1): string[] => cands.slice(nextCand, (nextCand += n));
const valueTime = (storage: Narrow, id: string): string => (lastValueEvent(storage, id) as { occurredAt: string }).occurredAt;

beforeAll(() => {
  db = createDb(PERF.seed, PERF.reducedEvents);
  cands = withValueEvent(db.storage);
}, SLOW);
afterAll(() => db.dispose());

describe('T-009 К17-кэш: правильность на одной БД, шаги по порядку', () => {
  // состояния между шагами; кэш и позиция создаются при первом обращении, чтобы каждый шаг падал по своей причине
  let cache: BalanceCache | undefined;
  let pOnce: string | undefined;
  const getCache = async (): Promise<BalanceCache> => (cache ??= await makeCache(db.storage));
  const pick = (): string => (pOnce ??= nth(take(), 0));
  let afterStep2: number;
  let cancelId = '';

  it('T-009 К17-кэш.0: кэш построен и совпадает со свёрткой (исходное состояние)', async () => {
    const cache = await getCache();
    expect(cache.all().size).toBe(PERF.products);
    expectMatchesReference(cache.all(), db.storage);
    pick();
    expect(cands.length, 'в журнале достаточно позиций со значением-событием').toBeGreaterThan(60);
  }, SLOW);

  it('T-009 К17-кэш.1: приращение задним числом раньше последней инвентаризации — совпадает, остаток позиции не изменился', async () => {
    const cache = await getCache();
    const p = pick();
    const before = stockBalance(db.storage.listStockEvents(p));
    put(db.storage, p, 'purchase', shift(valueTime(db.storage, p), -HOUR), { quantity: 777 });
    // balance() первым: обновление по знаку внутри balance() (без предшествующего all())
    expect(cache.balance(p)).toBe(before);
    expectMatchesReference(cache.all(), db.storage);
  });

  it('T-009 К17-кэш.2: приращение позже последней инвентаризации — совпадает, остаток изменился на величину приращения', async () => {
    const cache = await getCache();
    const p = pick();
    const before = stockBalance(db.storage.listStockEvents(p));
    put(db.storage, p, 'purchase', shift(valueTime(db.storage, p), HOUR), { quantity: 333 });
    expect(cache.balance(p), 'balance() первым, до all()').toBe(before + 333);
    expectMatchesReference(cache.all(), db.storage);
    afterStep2 = before + 333;
  });

  it('T-009 К17-кэш.3: отмена последнего значения-события — пересчёт от предыдущего значения-события', async () => {
    const cache = await getCache();
    const p = pick();
    const last = lastValueEvent(db.storage, p);
    if (!last) throw new Error('тест: нет значения-события');
    const cancel = put(db.storage, p, 'cancel', T0, { targetId: last.id });
    const without = db.storage.listStockEvents(p).filter((e) => e.id !== last.id && e.id !== cancel.id);
    expect(cache.balance(p), 'balance() первым, до all()').toBe(stockBalance(without));
    expectMatchesReference(cache.all(), db.storage);
    cancelId = cancel.id;
  });

  it('T-009 К17-кэш.4: отмена отмены — остаток равен остатку после шага 2', async () => {
    const cache = await getCache();
    const p = pick();
    put(db.storage, p, 'cancel', T0, { targetId: cancelId });
    expect(cache.balance(p), 'balance() первым, до all()').toBe(afterStep2);
    expectMatchesReference(cache.all(), db.storage);
  });

  it('T-009 К17-кэш.5: отмены автосписаний нескольких позиций одним recordSystemBatch на поддельных часах', async () => {
    const cache = await getCache();
    const ids = take(5);
    const app = makeScenarios(db.storage, fakeClock('2026-10-12T21:00:00.000Z'));
    const before = new Map(ids.map((id) => [id, stockBalance(db.storage.listStockEvents(id))]));
    const writes = app.recordSystemBatch(ids.map((id) => ({
      key: `auto_writeoff:${id}:t009`, productId: id, kind: 'auto_writeoff', quantity: 50,
      occurredAt: shift(valueTime(db.storage, id), HOUR), source: 'system',
    })));
    expect(writes.outcome).toBe('ok');
    expectMatchesReference(cache.all(), db.storage);
    for (const id of ids) expect(cache.balance(id), `после автосписания ${id}`).toBe((before.get(id) as number) - 50);

    const created = writes.outcome === 'ok' ? writes.items.map((i) => i.event.id) : [];
    const retro = app.recordSystemBatch(ids.map((id, k) => ({
      key: `absence_cancel:${nth(created, k)}`, productId: id, kind: 'cancel', targetId: nth(created, k),
      occurredAt: '2026-10-13T21:00:00.000Z', source: 'system',
    })));
    expect(retro.outcome).toBe('ok');
    expectMatchesReference(cache.all(), db.storage);
    for (const id of ids) expect(cache.balance(id), `после ретро-отмены ${id}`).toBe(before.get(id));
  });

  it('T-009 К17-кэш.6: новая позиция в каталоге после построения кэша — остаток 0 в all() и balance()', async () => {
    const cache = await getCache();
    expect(db.storage.addProduct(mkProduct('p-new-t009', 'Новая')).status).toBe('added');
    const all = cache.all();
    expect(all.get('p-new-t009')).toBe(0);
    expect(all.size).toBe(PERF.products + 1);
    expect(cache.balance('p-new-t009')).toBe(0);
    expectMatchesReference(all, db.storage);
  });

  it('T-009 К17-кэш.7: запись в транзакции, затем исключение — исключение проброшено, остаток позиции прежний', async () => {
    const cache = await getCache();
    const q = nth(take(), 0);
    const before = stockBalance(db.storage.listStockEvents(q));
    expect(() =>
      db.storage.transaction(() => {
        put(db.storage, q, 'purchase', shift(valueTime(db.storage, q), HOUR), { quantity: 999 });
        throw new Error('откат (тест)');
      }),
    ).toThrow('откат (тест)');
    expectMatchesReference(cache.all(), db.storage);
    expect(cache.balance(q)).toBe(before);
  });

  it('T-009 К17-кэш.8: событие через второе соединение к тому же файлу видно кэшу первого', async () => {
    const cache = await getCache();
    const q = nth(take(), 0);
    const before = stockBalance(db.storage.listStockEvents(q));
    const second = openSecond(db.path);
    try {
      put(second, q, 'purchase', shift(valueTime(second, q), HOUR), { quantity: 123 });
    } finally {
      second.close();
    }
    const got = cache.all();
    expectMatchesReference(got, db.storage);
    expect(got.get(q)).toBe(before + 123);
  });

  it('T-009 К17-кэш.9: внутри транзакции кэш не читается; после отката и записи в другую позицию с тем же seq — верно', async () => {
    const cache = await getCache();
    const [pp, qq] = [nth(take(), 0), nth(take(), 0)];
    const beforeP = stockBalance(db.storage.listStockEvents(pp));
    const beforeQ = stockBalance(db.storage.listStockEvents(qq));
    expectMatchesReference(cache.all(), db.storage);
    let rolledSeq = -1;
    expect(() =>
      db.storage.transaction(() => {
        rolledSeq = put(db.storage, pp, 'purchase', shift(valueTime(db.storage, pp), HOUR), { quantity: 4242 }).seq;
        expect(cache.balance(pp)).toBe(beforeP + 4242);
        const all = cache.all();
        expect(all.get(pp)).toBe(beforeP + 4242);
        expectMatchesReference(all, db.storage);
        throw new Error('откат (тест)');
      }),
    ).toThrow('откат (тест)');
    const q = put(db.storage, qq, 'purchase', shift(valueTime(db.storage, qq), HOUR), { quantity: 17 });
    expect(q.seq, 'ловушка: seq откаченного события занят записью другой позиции').toBe(rolledSeq);
    const got = cache.all();
    expectMatchesReference(got, db.storage);
    expect(got.get(pp)).toBe(beforeP);
    expect(got.get(qq)).toBe(beforeQ + 17);
    expect(cache.balance(pp)).toBe(beforeP);
  });

  it('T-009 К17-кэш.10: отрицательные остатки кэшируются как есть, без обрезки и исключения', async () => {
    const cache = await getCache();
    const q = nth(take(), 0);
    const bal = stockBalance(db.storage.listStockEvents(q));
    put(db.storage, q, 'portion', shift(valueTime(db.storage, q), HOUR), { quantity: Math.max(bal, 0) + 500 });
    const got = cache.all();
    expectMatchesReference(got, db.storage);
    expect(got.get(q)).toBe(bal - (Math.max(bal, 0) + 500));
    expect(got.get(q) as number).toBeLessThan(0);
    expect(cache.balance(q)).toBe(got.get(q));
    expect([...got.values()].some((v) => v < 0)).toBe(true);
  });
});

const sorted = (xs: readonly string[]): string[] => [...xs].sort();
/** Приращение после последнего значения-события позиции: гарантированно меняет остаток. */
const bump = (storage: Narrow, id: string, kind: 'purchase' | 'auto_writeoff' = 'auto_writeoff', quantity = 5) =>
  put(storage, id, kind, shift(valueTime(storage, id), HOUR), { quantity });

describe('T-009 К17-прогрев: warm() (ADR-003a §4.4)', () => {
  it('T-009 К17-прогрев.11: после автосписаний по k позициям warm() пересобирает их, затем all() не читает журнал', async () => {
    const c = counted(db.storage);
    const cache = await makeCache(c.storage);
    cache.all();
    const ids = take(6);
    db.storage.transaction(() => { for (const id of ids) bump(db.storage, id); });
    c.reset();
    cache.warm();
    expect(sorted(c.calls)).toStrictEqual(sorted(ids));
    const n = c.calls.length;
    const got = cache.all();
    expect(c.calls.length, 'all() после warm() не вызывает listStockEvents').toBe(n);
    expectMatchesReference(got, db.storage);
  }, SLOW);

  it('T-009 К17-прогрев.12: warm() внутри транзакции ничего не читает; all() после фиксации — как без warm()', async () => {
    const c = counted(db.storage);
    const cache = await makeCache(c.storage);
    cache.all();
    const id = nth(take(), 0);
    c.reset();
    let during = -1;
    db.storage.transaction(() => {
      bump(db.storage, id);
      const before = c.calls.length;
      cache.warm();
      during = c.calls.length - before;
    });
    expect(during, 'warm() внутри транзакции не вызывает listStockEvents').toBe(0);
    c.reset();
    const got = cache.all();
    expect(c.calls, 'all() пересобирает изменённую позицию, будто warm() не было').toStrictEqual([id]);
    expectMatchesReference(got, db.storage);
  }, SLOW);

  it('T-009 К17-прогрев.12: откат после warm() внутри транзакции — откаченного события в all() нет (даже при том же seq)', async () => {
    const c = counted(db.storage);
    const cache = await makeCache(c.storage);
    cache.all();
    const [id, other] = [nth(take(), 0), nth(take(), 0)];
    const before = stockBalance(db.storage.listStockEvents(id));
    let rolledSeq = -1;
    let during = -1;
    expect(() =>
      db.storage.transaction(() => {
        rolledSeq = bump(db.storage, id).seq;
        const n = c.calls.length;
        cache.warm();
        during = c.calls.length - n;
        throw new Error('откат (тест)');
      }),
    ).toThrow('откат (тест)');
    expect(during).toBe(0);
    const q = bump(db.storage, other);
    expect(q.seq, 'seq откаченного события занят другой позицией').toBe(rolledSeq);
    const got = cache.all();
    expectMatchesReference(got, db.storage);
    expect(got.get(id)).toBe(before);
  }, SLOW);

  it('T-009 К17-прогрев.13: сбой чтения посреди прогрева — warm() пробрасывает, потом all() верен по всем позициям', async () => {
    const c = counted(db.storage);
    const cache = await makeCache(c.storage);
    cache.all();
    const ids = take(3);
    for (const id of ids) bump(db.storage, id);
    c.failAfter(1);
    expect(() => cache.warm()).toThrow('сбой чтения журнала (тест)');
    expect(c.calls.length, 'до сбоя пересобрана одна позиция из трёх').toBe(1);
    c.disarm();
    c.reset();
    expectMatchesReference(cache.all(), db.storage);
  }, SLOW);
});

describe('T-009 Ш: инвалидация по знаку (ADR-003a §4.1.4)', () => {
  it('T-009 Ш1: без записей повторный all() не вызывает listStockEvents, результат прежний', async () => {
    const c = counted(db.storage);
    const cache = await makeCache(c.storage);
    const first = new Map(cache.all());
    c.reset();
    const again = cache.all();
    expect(c.calls).toStrictEqual([]);
    expect(new Map(again)).toStrictEqual(first);
    expectMatchesReference(again, db.storage);
  }, SLOW);

  it('T-009 Ш2: события в k разных позициях (одна — отмена) — listStockEvents ровно k раз, по одному на позицию', async () => {
    const c = counted(db.storage);
    const cache = await makeCache(c.storage);
    cache.all();
    const ids = take(5);
    for (const id of ids.slice(0, 4)) bump(db.storage, id, 'purchase', 40);
    const last = nth(ids, 4);
    put(db.storage, last, 'cancel', T0, { targetId: (lastValueEvent(db.storage, last) as { id: string }).id });
    c.reset();
    const got = cache.all();
    expect(c.calls).toHaveLength(5);
    expect(sorted(c.calls)).toStrictEqual(sorted(ids));
    expectMatchesReference(got, db.storage);
  }, SLOW);

  it('T-009 Ш4: пустой кэш строится целиком — по одному вызову на каждую позицию каталога', async () => {
    const c = counted(db.storage);
    const cache = await makeCache(c.storage);
    c.reset();
    const got = cache.all();
    const ids = db.storage.listProducts().map((x) => x.id);
    expect(c.calls).toHaveLength(ids.length);
    expect(sorted(c.calls)).toStrictEqual(sorted(ids));
    expectMatchesReference(got, db.storage);
  }, SLOW);

  it('T-009 Ш5: знак читается до пересборки — запись вторым соединением во время пересборки не теряется (ADR-003a §4.1.4.1)', async () => {
    const [p, q] = take(2) as [string, string];
    let fired = false;
    let armed = false;
    const wrapped: Narrow = {
      ...db.storage,
      listStockEvents: (id: string) => {
        const r = db.storage.listStockEvents(id);
        if (armed && !fired && id === p) {
          fired = true;
          const s2 = openSecond(db.path);
          try { put(s2, p, 'purchase', shift(valueTime(s2, p), HOUR), { quantity: 9 }); } finally { s2.close(); }
        }
        return r; // содержимое до записи второго соединения
      },
    };
    const cache = await makeCache(wrapped);
    expectMatchesReference(cache.all(), db.storage);
    put(db.storage, p, 'purchase', shift(valueTime(db.storage, p), HOUR), { quantity: 1 });
    put(db.storage, q, 'purchase', shift(valueTime(db.storage, q), HOUR), { quantity: 1 });
    armed = true;
    cache.all(); // пересборка p; во время неё второе соединение пишет в p
    expect(fired, 'запись второго соединения произошла во время пересборки').toBe(true);
    armed = false;
    expectMatchesReference(cache.all(), db.storage);
    expect(cache.balance(p)).toBe(stockBalance(db.storage.listStockEvents(p)));
  }, SLOW);

  it('T-009 Ш3: журнал стал короче (подмена файла) — кэш сброшен, all() совпадает со свёрткой второй БД', async () => {
    const long = createDb(PERF.seed, 6000);
    const short = createDb(PERF.seed + 1, 2000);
    try {
      const target = { cur: long.storage };
      const proxy = Object.fromEntries(
        Object.keys(long.storage).map((k) => [k, (...a: unknown[]) => (target.cur as never as Record<string, (...x: unknown[]) => unknown>)[k]?.(...a)]),
      ) as unknown as Narrow;
      const cache = await makeCache(proxy);
      expectMatchesReference(cache.all(), long.storage);
      expect(short.journal.events.length).toBeLessThan(long.journal.events.length);
      const [r1, r2] = [reference(long.storage), reference(short.storage)];
      expect([...r1].some(([id, v]) => r2.get(id) !== v), 'остатки баз различаются').toBe(true);
      target.cur = short.storage;
      expectMatchesReference(cache.all(), short.storage);
    } finally {
      long.dispose();
      short.dispose();
    }
  }, SLOW);
});
