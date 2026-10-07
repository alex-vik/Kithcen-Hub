// T-004: хранилище SQLite (ADR-002). Единственное место, где виден node:sqlite (ADR-004).
// Остаток не хранится и не считается здесь: отдаются упорядоченные события (BR-01, ADR-003 §3).
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import type { Product, StateEvent } from '../../domain/catalog.ts';
import type { StockEvent } from '../../domain/journal.ts';
import { isInstant } from '../../domain/time.ts';

export type WriteResult<E> =
  | { status: 'added'; event: E }
  | { status: 'exists'; event: E }
  | { status: 'rejected'; reason: 'unknown_product' | 'invalid_time' | 'invalid_target' };

export type Pragmas = {
  journalMode: string;
  synchronous: number;
  foreignKeys: number;
  busyTimeoutMs: number;
  userVersion: number;
};

export type StorageOptions = {
  /** Файл БД или ':memory:'. */
  path: string;
  /** Раздел 15 спеки, по умолчанию 5000; значение приходит из конфигурации. */
  busyTimeoutMs: number;
  /** Тексты миграций по порядку, версия = номер; без параметра — файлы migrations/NNNN_*.sql. */
  migrations?: readonly string[];
};

export type Storage = {
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
  /** T-009, ADR-003a §5: MAX(seq) журнала остатка, 0 при пустом. */
  maxStockSeq(): number;
  /** T-009: различные позиции событий с afterSeq < seq <= uptoSeq (отмена — позиция цели). */
  productsChangedBetween(afterSeq: number, uptoSeq: number): string[];
  /** T-009: true только пока выполняется fn внешней или вложенной transaction. */
  inTransaction(): boolean;
  /**
   * Несколько чтений и вставок атомарно; вложенный вызов входит в внешнюю транзакцию.
   * Всё или ничего: исключение из fn откатывает транзакцию и пробрасывается дальше.
   * fn только синхронный: драйвер синхронный, async-функция завершилась бы после COMMIT (тип запрещает Promise).
   */
  transaction<T>(fn: () => T & SyncOnly<T>): T;
};

/** never для Promise: async-функцию в transaction передать нельзя. */
type SyncOnly<T> = T extends PromiseLike<unknown> ? never : unknown;

type Row = Record<string, unknown>;

function loadMigrations(): string[] {
  const dir = new URL('./migrations/', import.meta.url);
  const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  return files.map((f, i) => {
    if (Number(f.slice(0, 4)) !== i + 1) throw new Error(`миграции: ожидался номер ${i + 1}, найден ${f}`);
    return readFileSync(new URL(f, dir), 'utf8');
  });
}

function migrate(db: DatabaseSync, migrations: readonly string[]): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as Row)['user_version']);
  for (let v = current + 1; v <= migrations.length; v++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migrations[v - 1] as string);
      db.exec(`PRAGMA user_version = ${v}`);
      db.exec('COMMIT');
    } catch (err) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw err;
    }
  }
}

const opt = <K extends string>(key: K, v: unknown): Partial<Record<K, never>> =>
  (v === null || v === undefined ? {} : { [key]: v }) as Partial<Record<K, never>>;

const toProduct = (r: Row): Product => ({
  id: r['id'] as string,
  name: r['name'] as string,
  category: r['category'] as string | null,
  writeOffType: r['write_off_type'] as Product['writeOffType'],
  unit: r['unit'] as Product['unit'],
  packName: r['pack_name'] as string,
  unitsPerPack: r['units_per_pack'] as number,
  norm: r['norm'] as number | null,
  lowThreshold: r['low_threshold'] as number | null,
  portion: r['portion'] as number | null,
});

const toStock = (r: Row): StockEvent => ({
  id: r['id'] as string,
  seq: Number(r['seq']),
  productId: r['product_id'] as string,
  kind: r['kind'] as StockEvent['kind'],
  ...opt('quantity', r['quantity']),
  ...opt('value', r['value']),
  ...opt('packs', r['packs']),
  ...opt('unitsPerPack', r['units_per_pack']),
  ...opt('targetId', r['target_id']),
  occurredAt: r['occurred_at'] as string,
  recordedAt: r['recorded_at'] as string,
  source: r['source'] as string,
});

const toState = (r: Row): StateEvent => ({
  id: r['id'] as string,
  seq: Number(r['seq']),
  productId: r['product_id'] as string,
  occurredAt: r['occurred_at'] as string,
  recordedAt: r['recorded_at'] as string,
  state: r['state'] as StateEvent['state'],
  reason: r['reason'] as StateEvent['reason'],
  ...opt('refEventId', r['ref_event_id']),
});

const n = (v: number | undefined): number | null => v ?? null;

export function openStorage(options: StorageOptions): Storage {
  const { path, busyTimeoutMs } = options;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) throw new Error('busyTimeoutMs: целое число не меньше 0');
  const migrations = options.migrations ?? loadMigrations();

  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, migrations);
  } catch (err) {
    db.close();
    throw err;
  }

  const all = (sql: string, ...p: SQLInputValue[]): Row[] => db.prepare(sql).all(...p) as Row[];
  const get = (sql: string, ...p: SQLInputValue[]): Row | undefined => db.prepare(sql).get(...p) as Row | undefined;
  const pragma = (name: string, col = name): unknown => (get(`PRAGMA ${name}`) as Row)[col];

  let depth = 0;
  function transaction<T>(fn: () => T & SyncOnly<T>): T {
    if (depth > 0) return fn();
    db.exec('BEGIN IMMEDIATE');
    depth = 1;
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw err;
    } finally {
      depth = 0;
    }
  }

  const productExists = (id: string): boolean => get('SELECT 1 AS x FROM product WHERE id = ?', id) !== undefined;
  const getStockEvent = (id: string): StockEvent | undefined => {
    const r = get('SELECT * FROM stock_event WHERE id = ?', id);
    return r && toStock(r);
  };
  const getStateEvent = (id: string): StateEvent | undefined => {
    const r = get('SELECT * FROM state_event WHERE id = ?', id);
    return r && toState(r);
  };

  return {
    close: () => db.close(),
    pragmas: () => ({
      journalMode: String(pragma('journal_mode')),
      synchronous: Number(pragma('synchronous')),
      foreignKeys: Number(pragma('foreign_keys')),
      busyTimeoutMs: Number(pragma('busy_timeout', 'timeout')),
      userVersion: Number(pragma('user_version')),
    }),

    addProduct: (p) =>
      db
        .prepare(
          `INSERT INTO product (id, name, category, write_off_type, unit, pack_name, units_per_pack, norm, low_threshold, portion)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
        )
        .run(p.id, p.name, p.category, p.writeOffType, p.unit, p.packName, p.unitsPerPack, p.norm, p.lowThreshold, p.portion)
        .changes > 0
        ? { status: 'added' }
        : { status: 'exists' },
    editProduct: (p) =>
      db
        .prepare(
          `UPDATE product SET name = ?, category = ?, write_off_type = ?, pack_name = ?, units_per_pack = ?,
             norm = ?, low_threshold = ?, portion = ? WHERE id = ?`,
        )
        .run(p.name, p.category, p.writeOffType, p.packName, p.unitsPerPack, p.norm, p.lowThreshold, p.portion, p.id)
        .changes > 0
        ? { status: 'updated' }
        : { status: 'unknown_product' },
    getProduct: (id) => {
      const r = get('SELECT * FROM product WHERE id = ?', id);
      return r && toProduct(r);
    },
    listProducts: () => all('SELECT * FROM product ORDER BY id').map(toProduct),

    addStockEvent: (e) =>
      transaction((): WriteResult<StockEvent> => {
        if (!isInstant(e.occurredAt) || !isInstant(e.recordedAt)) return { status: 'rejected', reason: 'invalid_time' };
        if (!productExists(e.productId)) return { status: 'rejected', reason: 'unknown_product' };
        const recorded = getStockEvent(e.id);
        if (recorded) return { status: 'exists', event: recorded };
        if (e.kind === 'cancel') {
          // ADR-003 §6: цель — событие остатка той же позиции; seq цели меньше, т.к. она уже записана.
          const target = e.targetId === undefined ? undefined : getStockEvent(e.targetId);
          if (!target || target.productId !== e.productId) return { status: 'rejected', reason: 'invalid_target' };
        }
        db.prepare(
          `INSERT INTO stock_event
             (id, seq, product_id, kind, quantity, value, packs, units_per_pack, target_id, occurred_at, recorded_at, source)
           VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM stock_event), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          e.id, e.productId, e.kind, n(e.quantity), n(e.value), n(e.packs), n(e.unitsPerPack), e.targetId ?? null,
          e.occurredAt, e.recordedAt, e.source,
        );
        return { status: 'added', event: getStockEvent(e.id) as StockEvent };
      }),
    addStateEvent: (e) =>
      transaction((): WriteResult<StateEvent> => {
        if (!isInstant(e.occurredAt) || !isInstant(e.recordedAt)) return { status: 'rejected', reason: 'invalid_time' };
        if (!productExists(e.productId)) return { status: 'rejected', reason: 'unknown_product' };
        const recorded = getStateEvent(e.id);
        if (recorded) return { status: 'exists', event: recorded };
        db.prepare(
          `INSERT INTO state_event (id, seq, product_id, state, reason, ref_event_id, occurred_at, recorded_at)
           VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM state_event), ?, ?, ?, ?, ?, ?)`,
        ).run(e.id, e.productId, e.state, e.reason, e.refEventId ?? null, e.occurredAt, e.recordedAt);
        return { status: 'added', event: getStateEvent(e.id) as StateEvent };
      }),

    getStockEvent,
    listStockEvents: (productId) =>
      all('SELECT * FROM stock_event WHERE product_id = ? ORDER BY occurred_at, seq', productId).map(toStock),
    listStateEvents: (productId) =>
      all('SELECT * FROM state_event WHERE product_id = ? ORDER BY occurred_at, seq', productId).map(toState),
    hasStockEvents: (productId) => get('SELECT 1 AS x FROM stock_event WHERE product_id = ? LIMIT 1', productId) !== undefined,
    maxStockSeq: () => Number((get('SELECT COALESCE(MAX(seq), 0) AS m FROM stock_event') as Row)['m']),
    productsChangedBetween: (afterSeq, uptoSeq) =>
      all('SELECT DISTINCT product_id FROM stock_event WHERE seq > ? AND seq <= ?', afterSeq, uptoSeq).map(
        (r) => r['product_id'] as string,
      ),
    inTransaction: () => depth > 0,
    transaction,
  };
}
