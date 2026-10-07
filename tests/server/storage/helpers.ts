// T-004: общие помощники тестов хранилища. Не тест (имя без .test).
// Интерфейс хранилища (src/server/storage/index.ts) задан этими тестами:
//   openStorage({ path, busyTimeoutMs, migrations? }): Storage   // синхронный; path — файл или ':memory:'
//     migrations? — тексты SQL по порядку, версия = номер (1, 2, ...); без параметра — файлы src/server/storage/migrations/NNNN_*.sql
//   Storage: close(), pragmas(), addProduct, editProduct, getProduct, listProducts,
//            addStockEvent, addStateEvent, getStockEvent, listStockEvents, listStateEvents, hasStockEvents, transaction
//   Схема (имена нужны тестам прямого SQL): product, stock_event, state_event; столбцы snake_case
//   (id, seq, product_id, kind, quantity, value, packs, units_per_pack, target_id, occurred_at, recorded_at, source;
//    state, reason, ref_event_id).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createProduct } from '../../../src/domain/catalog.ts';
import type { Product, StateEvent } from '../../../src/domain/catalog.ts';
import { createStockEvent } from '../../../src/domain/journal.ts';
import type { StockEvent, StockEventInput } from '../../../src/domain/journal.ts';
import { openStorage } from '../../../src/server/storage/index.ts';

export type Pragmas = {
  journalMode: string;
  synchronous: number;
  foreignKeys: number;
  busyTimeoutMs: number;
  userVersion: number;
};
export type WriteResult<E> =
  | { status: 'added'; event: E }
  | { status: 'exists'; event: E }
  | { status: 'rejected'; reason: 'unknown_product' | 'invalid_time' | 'invalid_target' };
export type StorageApi = {
  close(): void;
  pragmas(): Pragmas;
  addProduct(p: Product): { status: 'added' } | { status: 'exists' };
  editProduct(p: Product): { status: 'updated' } | { status: 'unknown_product' };
  getProduct(id: string): Product | undefined;
  listProducts(): Product[];
  addStockEvent(e: StockEvent): WriteResult<StockEvent>;
  addStateEvent(e: StateEvent): WriteResult<StateEvent>;
  getStockEvent(id: string): StockEvent | undefined;
  listStockEvents(productId: string): StockEvent[];
  listStateEvents(productId: string): StateEvent[];
  hasStockEvents(productId: string): boolean;
  transaction<T>(fn: () => T): T;
};

// через unknown: форму реализации задают тесты поведением, а не именами типов backend-dev
export const open = openStorage as unknown as (o: {
  path: string;
  busyTimeoutMs: number;
  migrations?: readonly string[];
}) => StorageApi;

export const T0 = '2026-10-12T09:00:00.000Z';
export const REC = '2026-10-12T09:00:05.000Z';
export const at = (day: string, hhmm: string) => `2026-10-${day}T${hhmm}:00.000Z`;

export function nth<T>(a: readonly T[], i: number): T {
  const v = a[i];
  if (v === undefined) throw new Error(`тест: нет элемента ${i} (длина ${a.length})`);
  return v;
}

export function mkProduct(id: string, name: string, unit: 'г' | 'мл' | 'шт' = 'г', unitsPerPack = 900): Product {
  const r = createProduct({ id, name, unit, packName: 'пачка', unitsPerPack });
  if (!r.ok) throw new Error(`тест: позиция не создана: ${r.error.attribute}`);
  return r.value;
}

/** Событие остатка через домен; seq — произвольный, хранилище его заменит. */
export function stock(
  p: Product,
  id: string,
  kind: StockEventInput['kind'],
  occurredAt: string,
  extra: Partial<StockEventInput> = {},
): StockEvent {
  const r = createStockEvent(p, { id, seq: 0, kind, occurredAt, recordedAt: REC, source: 'test', ...extra });
  if (!r.ok) throw new Error(`тест: событие не создано: ${r.error.attribute}`);
  return r.value;
}

export function state(
  productId: string,
  id: string,
  occurredAt: string,
  st: StateEvent['state'],
  reason: StateEvent['reason'],
  extra: { refEventId?: string; recordedAt?: string } = {},
): StateEvent {
  return { id, seq: 0, productId, occurredAt, recordedAt: extra.recordedAt ?? REC, state: st, reason,
    ...(extra.refEventId === undefined ? {} : { refEventId: extra.refEventId }) };
}

export function added<E>(r: WriteResult<E>): E {
  if (r.status !== 'added') throw new Error(`тест: ожидалась запись, получено ${JSON.stringify(r)}`);
  return r.event;
}

const dirs: string[] = [];
export function tmpFile(): string {
  const d = mkdtempSync(join(tmpdir(), 'kh-t004-'));
  dirs.push(d);
  return join(d, 'kitchen.sqlite');
}
export function cleanup(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** Хранилище на временном файле + отдельное прямое соединение «в обход репозиториев». */
export function openFile(busyTimeoutMs = 5000) {
  const path = tmpFile();
  const storage = open({ path, busyTimeoutMs });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA busy_timeout = 5000');
  return { path, storage, raw };
}

export const count = (raw: DatabaseSync, table: string): number =>
  Number((raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number | bigint }).n);
