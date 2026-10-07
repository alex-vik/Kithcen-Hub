// T-008 К16-К17 на полном журнале и T-009 К16-доп, К18 (путь (в) через кэш), К18-утро, К18-вывод.
// Только npm run perf; в npm test не входит. ADR-003 §3 в редакции ADR-003a §6.2, Q-02.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { stockBalance } from '../../src/domain/journal.ts';
import { openStorage } from '../../src/server/storage/index.ts';
import { counted, lastValueEvent, makeCache, put, shift, HOUR } from '../server/app/balances-helpers.ts';
import type { BalanceCache, Counted, Narrow } from '../server/app/balances-helpers.ts';
import {
  checkDeterminism, checkFreshObjects, checkJournalShape, checkPeriodAligned, checkWindowsInterleaved, compareBalances,
} from './checks.ts';
import { PERF } from './config.ts';
import {
  balancesInMemory, balancesViaStorage, freshEventsByProduct, generateJournal, groupByProduct, loadIntoStorage, median,
  percentile,
} from './journal.ts';

const ms = (x: number): string => x.toFixed(1);
const stats = (xs: number[]): string =>
  `медиана ${ms(median(xs))} мс, p90 ${ms(percentile(xs, 0.9))} мс, min ${ms(Math.min(...xs))} мс, max ${ms(Math.max(...xs))} мс`;

function measure(fn: () => unknown): number[] {
  for (let i = 0; i < PERF.warmup; i++) fn();
  const out: number[] = [];
  for (let i = 0; i < PERF.repeats; i++) {
    const t0 = performance.now();
    fn();
    out.push(performance.now() - t0);
  }
  return out;
}

const timed = <T>(fn: () => T): [T, number] => {
  const t0 = performance.now();
  const r = fn();
  return [r, performance.now() - t0];
};

describe('T-009 полный журнал', () => {
  const g0 = performance.now();
  const journal = generateJournal(PERF.seed, PERF.fullEvents);
  const genMs = performance.now() - g0;
  const dir = mkdtempSync(join(tmpdir(), 't009-perf-'));
  const path = join(dir, 'perf.db');
  let loadMs = Number.NaN;
  let loaded = false;
  // общее состояние К18 → К18-утро → К18-вывод
  const m: {
    cold?: number; v?: number[]; morning?: number; warmAfterNight?: number; heavy?: string;
    storage?: Narrow; counted?: Counted; cache?: BalanceCache;
  } = {};

  afterAll(() => {
    try { m.storage?.close(); } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('T-008 К16: полный журнал 500 тыс. событий, 200 позиций, 60 ритмичных, ≤5000 на позицию, все виды', () => {
    checkJournalShape(journal, PERF.fullEvents);
  });

  it('T-008 К16: тот же сид даёт тот же журнал, другой — иной (на полном объёме)', () => {
    checkDeterminism(PERF.fullEvents);
  });

  it('T-009 К16-доп.1: первое и последнее событие каждой позиции — в крайних 5% периода журнала (полный объём)', () => {
    checkPeriodAligned(journal);
  });

  it('T-009 К16-доп.2: в окнах по 1000 событий (начало, середина, конец) больше 20 различных позиций (полный объём)', () => {
    checkWindowsInterleaved(journal);
  });

  it('T-008 К17: остатки всех позиций в памяти и через хранилище совпадают (полный объём)', () => {
    const writer = openStorage({ path, busyTimeoutMs: 5000 });
    try {
      const l0 = performance.now();
      loadIntoStorage(writer, journal);
      loadMs = performance.now() - l0;
      loaded = true;
      compareBalances(journal, writer);
      // К16-доп.3 на загруженной БД, без повторной загрузки 500 тыс. событий
      checkFreshObjects(journal, writer);
    } finally {
      writer.close();
    }
  });

  it('T-009 К18: медиана cache.all() с пересборкой одной тяжёлой позиции ≤ 100 мс; один listStockEvents на повтор', async () => {
    expect(loaded, 'К17 не загрузил БД').toBe(true);
    // БД из К17 открывается заново, кэш создаётся над обёрткой-счётчиком.
    const storage = openStorage({ path, busyTimeoutMs: 5000 }) as unknown as Narrow;
    m.storage = storage;
    const c = counted(storage);
    m.counted = c;
    const cache = await makeCache(c.storage);
    m.cache = cache;

    const [, cold] = timed(() => cache.all());
    m.cold = cold;
    const heavy = [...groupByProduct(journal.events)].sort((a, b) => b[1].length - a[1].length)[0]?.[0] as string;
    m.heavy = heavy;

    // Вне замера — запись в самую тяжёлую позицию: чётные повторы — приращение раньше последней инвентаризации,
    // нечётные — отмена последнего действующего значения-события.
    let step = 0;
    const prepare = (): void => {
      const last = lastValueEvent(storage, heavy);
      if (!last) throw new Error(`тест: у ${heavy} нет значения-события`);
      if (step++ % 2 === 0) put(storage, heavy, 'purchase', shift(last.occurredAt, -HOUR), { quantity: 11 });
      else put(storage, heavy, 'cancel', last.occurredAt, { targetId: last.id });
    };
    const rebuilds: number[] = [];
    const one = (record: boolean): number => {
      prepare();
      c.reset();
      const [, dt] = timed(() => cache.all());
      if (record) rebuilds.push(c.calls.length);
      return dt;
    };
    for (let i = 0; i < PERF.warmup; i++) one(false);
    const times: number[] = [];
    for (let i = 0; i < PERF.repeats; i++) times.push(one(true));
    m.v = times;

    const med = median(times);
    console.log([
      `[T-009 К18] Node ${process.version}; событий ${journal.events.length}, позиций ${journal.products.length}, тяжёлая позиция ${heavy}`,
      `[T-009 К18] (в) кэш, пересборка одной позиции: ${stats(times)}; холодное построение ${ms(cold)} мс`,
      '[T-009 К18] замер в среде разработки, не на целевом сервере (Q-02)',
    ].join('\n'));
    expect(rebuilds, 'в каждом повторе listStockEvents вызван ровно один раз (замер мерит пересборку, а не попадание в кэш)')
      .toStrictEqual(Array.from({ length: PERF.repeats }, () => 1));
    expect(cache.balance(heavy), 'остаток тяжёлой позиции равен свёртке').toBe(stockBalance(storage.listStockEvents(heavy)));
    expect(
      med,
      `сработало условие ADR-003 §3: кэш не укладывается, см. ADR-003a §7 (медиана ${ms(med)} мс > ${PERF.thresholdMs} мс)`,
    ).toBeLessThanOrEqual(PERF.thresholdMs);
  });

  it('T-009 К18-утро: ночной пакет в 60 ритмичных, warm(), одна отметка в тяжёлую позицию — cache.all() ≤ 100 мс, остатки верны', () => {
    const { storage, cache, heavy } = m;
    if (!storage || !cache || !heavy) throw new Error('К18 не выполнен: нет БД, кэша или тяжёлой позиции');
    const rhythmic = journal.products.filter((p) => p.writeOffType === 'rhythmic').map((p) => p.id);
    expect(rhythmic).toHaveLength(PERF.rhythmic);
    const after = (id: string): string => shift(lastValueEvent(storage, id)?.occurredAt ?? '2025-01-01T00:00:00.000Z', HOUR);
    // вне замера: ночной пакет одной транзакцией
    storage.transaction(() => { for (const id of rhythmic) put(storage, id, 'auto_writeoff', after(id), { quantity: 30 }); });
    const [, warmMs] = timed(() => cache.warm());
    m.warmAfterNight = warmMs;
    put(storage, heavy, 'portion', after(heavy), { quantity: 25 });
    const [got, allMs] = timed(() => cache.all());
    m.morning = allMs;
    console.log(`[T-009 К18-утро] warm() после ночного пакета ${ms(warmMs)} мс; утренний cache.all() ${ms(allMs)} мс`);
    for (const id of [...rhythmic, heavy]) expect(got.get(id), `остаток ${id}`).toBe(stockBalance(storage.listStockEvents(id)));
    expect(allMs, `утро: cache.all() ${ms(allMs)} мс > ${PERF.thresholdMs} мс`).toBeLessThanOrEqual(PERF.thresholdMs);
  });

  it('T-009 К18-вывод (без проверки): пути (а) и (б) для тренда, статистика (в), холодное построение, warm(), утро, триггер D1', () => {
    const storage = m.storage;
    if (!storage) throw new Error('К18 не выполнен: нет открытого хранилища');
    const fresh = freshEventsByProduct(journal);
    const mem = measure(() => balancesInMemory(fresh));
    const sto = measure(() => balancesViaStorage(storage));
    const lines = [
      `[T-009 К18-вывод] Node ${process.version}; генерация ${ms(genMs)} мс, вставка в хранилище ${ms(loadMs)} мс`,
      `[T-009 К18-вывод] (а) память (объекты К16-доп.3): ${stats(mem)}`,
      `[T-009 К18-вывод] (б) хранилище: ${stats(sto)}`,
      m.v ? `[T-009 К18-вывод] (в) кэш: ${stats(m.v)}` : '[T-009 К18-вывод] (в) кэш: нет данных',
      `[T-009 К18-вывод] холодное построение ${m.cold === undefined ? 'нет данных' : `${ms(m.cold)} мс`}; ` +
        `warm() после ночного пакета ${m.warmAfterNight === undefined ? 'нет данных' : `${ms(m.warmAfterNight)} мс`}; ` +
        `утро ${m.morning === undefined ? 'нет данных' : `${ms(m.morning)} мс`}`,
      '[T-009 К18-вывод] замер в среде разработки, не на целевом сервере (Q-02)',
    ];
    if ((m.v && median(m.v) > PERF.d1MedianMs) || (m.warmAfterNight ?? 0) > PERF.d1WarmMs) {
      lines.push('[T-009 К18-вывод] триггер D1 (ADR-003a §7)');
    }
    console.log(lines.join('\n'));
    // vitest 5 не печатает console.log прошедших тестов: цифры дублируются в файл (каталог создаётся здесь)
    const st = (xs: number[]) => ({ median: median(xs), p90: percentile(xs, 0.9), min: Math.min(...xs), max: Math.max(...xs) });
    const outDir = join(dirname(fileURLToPath(import.meta.url)), '.out');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'last.json'), JSON.stringify({
      node: process.version, events: journal.events.length, products: journal.products.length, heavy: m.heavy,
      thresholdMs: PERF.thresholdMs, generateMs: genMs, loadMs,
      pathA_memory: st(mem), pathB_storage: st(sto), pathC_cache: m.v ? st(m.v) : null,
      coldBuildMs: m.cold ?? null, warmAfterNightMs: m.warmAfterNight ?? null, morningAllMs: m.morning ?? null,
      triggerD1: lines.some((l) => l.includes('триггер D1')), note: 'среда разработки, не целевой сервер (Q-02)',
    }, null, 2));
    expect(lines.length).toBeGreaterThan(0);
  });
});
