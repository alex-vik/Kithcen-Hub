// T-009: помощники тестов кэша остатков. Не тест (имя без .test).
// Интерфейс, заданный тестами (ADR-003a §5; НВ-7 а — имена контракт), src/server/app/balances.ts:
//   createBalanceCache({ storage }): BalanceCache
//   BalanceCache = { balance(productId): number; all(): ReadonlyMap<string, number>; warm(): void }
// Кэш использует только интерфейс Storage: тест подставляет обёртки (счётчик, бросающая, подмена БД).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { cancelledIds, stockBalance } from '../../../src/domain/journal.ts';
import type { StockEvent, StockEventKind } from '../../../src/domain/journal.ts';
import { openStorage } from '../../../src/server/storage/index.ts';
import { generateJournal, loadIntoStorage } from '../../perf/journal.ts';
import type { Journal } from '../../perf/journal.ts';
import { added, nth, stock } from '../storage/helpers.ts';
import type { StorageApi } from '../storage/helpers.ts';

export { nth };

/** Storage с методами ADR-003a §5 (в Storage их пока нет — типы тестов не зависят от реализации). */
export type Narrow = StorageApi & {
  maxStockSeq(): number;
  productsChangedBetween(afterSeq: number, uptoSeq: number): string[];
  inTransaction(): boolean;
  /** T-010: курсор job_runs; Narrow повторяет весь Storage, чтобы перф-тесты проходили typecheck. */
  lastJobDay(job: string): string | undefined;
  markJobDay(job: string, day: string): void;
  /** T-012: периоды отпуска; Narrow повторяет весь Storage (перф-тесты, typecheck). */
  addAbsencePeriod(p: { id: string; start: string; end: string; recordedAt: string }): { status: 'added' | 'exists'; period: { id: string; start: string; end: string; recordedAt: string } };
  listAbsencePeriods(): { id: string; start: string; end: string; recordedAt: string }[];
};
export type BalanceCache = {
  balance(productId: string): number;
  all(): ReadonlyMap<string, number>;
  warm(): void;
};

const FACTORY_URL = new URL('../../../src/server/app/balances.ts', import.meta.url).href;

/** Загрузка отложена до вызова: пока модуля нет, падает каждый тест по отдельности, а не весь файл. */
export async function makeCache(storage: unknown): Promise<BalanceCache> {
  const mod = (await import(/* @vite-ignore */ FACTORY_URL)) as {
    createBalanceCache: (d: { storage: unknown }) => BalanceCache;
  };
  return mod.createBalanceCache({ storage });
}

export type Db = { path: string; storage: Narrow; journal: Journal; dispose(): void };

/** Временная файловая БД с журналом К16 (T-008); удаляется в dispose (вызывать в finally/afterAll). */
export function createDb(seed: number, events: number): Db {
  const journal = generateJournal(seed, events);
  const dir = mkdtempSync(join(tmpdir(), 't009-'));
  const path = join(dir, 'cache.db');
  const raw = openStorage({ path, busyTimeoutMs: 5000 });
  const storage = raw as unknown as Narrow;
  try {
    loadIntoStorage(raw, journal);
  } catch (err) {
    raw.close();
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return {
    path, storage, journal,
    dispose: () => {
      try { storage.close(); } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  };
}

export const openSecond = (path: string): Narrow =>
  openStorage({ path, busyTimeoutMs: 5000 }) as unknown as Narrow;

/** Эталон: свёртка по каждой позиции каталога (путь (б) T-008). */
export function reference(storage: StorageApi): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of storage.listProducts()) out.set(p.id, stockBalance(storage.listStockEvents(p.id)));
  return out;
}

/** «Совпадает со свёрткой»: тот же набор ключей, что у listProducts(), точное равенство значений. */
export function expectMatchesReference(got: ReadonlyMap<string, number>, storage: StorageApi): void {
  const want = reference(storage);
  expect([...got.keys()].sort()).toStrictEqual([...want.keys()].sort());
  for (const [id, v] of want) expect(got.get(id), `остаток ${id}`).toBe(v);
}

export type Counted = {
  storage: Narrow;
  /** id позиций по порядку вызовов listStockEvents обёртки. */
  calls: string[];
  reset(): void;
  /** Бросить исключение на вызове listStockEvents после n успешных вызовов (с последнего reset/arm). */
  failAfter(n: number): void;
  disarm(): void;
};

/** Обёртка-счётчик вызовов listStockEvents; остальное — как у исходного хранилища. */
export function counted(storage: Narrow): Counted {
  const calls: string[] = [];
  let limit: number | null = null;
  const wrapper: Narrow = {
    ...storage,
    listStockEvents: (id) => {
      if (limit !== null && calls.length >= limit) throw new Error('сбой чтения журнала (тест)');
      calls.push(id);
      return storage.listStockEvents(id);
    },
  };
  return {
    storage: wrapper, calls,
    reset: () => { calls.length = 0; },
    failAfter: (n) => { calls.length = 0; limit = n; },
    disarm: () => { limit = null; },
  };
}

export const shift = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();
export const HOUR = 3_600_000;

/** Последнее действующее значение-событие (inventory/depleted) позиции в порядке (occurredAt, seq). */
export function lastValueEvent(storage: StorageApi, id: string): StockEvent | undefined {
  const events = storage.listStockEvents(id);
  const cancelled = cancelledIds(events);
  return events
    .filter((e) => (e.kind === 'inventory' || e.kind === 'depleted') && !cancelled.has(e.id))
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.seq - b.seq))
    .at(-1);
}

/** Позиции, у которых есть действующее значение-событие (нужны для «до/после последней инвентаризации»). */
export function withValueEvent(storage: StorageApi): string[] {
  return storage.listProducts().map((p) => p.id).filter((id) => lastValueEvent(storage, id) !== undefined);
}

let counter = 0;
/** Запись события в позицию через интерфейс хранилища; seq назначает хранилище. */
export function put(
  storage: StorageApi,
  productId: string,
  kind: StockEventKind,
  occurredAt: string,
  extra: { quantity?: number; value?: number; targetId?: string } = {},
): StockEvent {
  const product = storage.getProduct(productId);
  if (!product) throw new Error(`тест: нет позиции ${productId}`);
  return added(storage.addStockEvent(stock(product, `t009-${++counter}`, kind, occurredAt, extra)));
}
