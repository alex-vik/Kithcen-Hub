// Хранение (ADR-002): openDb, миграции, каталог позиций (T-001, ADR-003 раздел 4).
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import {
  diffProduct, foldStock, newProductAttrs, newProductRow, productFields, stockEventQty, validateNewProduct, validateProductPatch,
  validateStockEventInput,
} from '../../domain/index.ts';
import type { Params, Product, ProductField, StockEventType, StockFoldEvent } from '../../domain/index.ts';

const migrationsDir = new URL('./migrations/', import.meta.url);

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
  const files = readdirSync(migrationsDir).filter((f) => /^\d{4}-.*\.sql$/.test(f)).sort();
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (const file of files) {
    const version = Number(file.slice(0, 4));
    if (version <= current) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(new URL(file, migrationsDir), 'utf8'));
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

type Instant = Temporal.Instant;
type Result = { ok: true; product: Product } | { ok: false; errors: { field: string }[] };

function toProduct(r: Record<string, unknown>): Product {
  return {
    id: r.id as string,
    name: r.name as string,
    category: r.category as string | null,
    unit: r.unit as string,
    minimum: r.minimum as number | null,
    active: r.active === 1,
  };
}

export function getProduct(db: DatabaseSync, id: unknown): Product | null {
  if (typeof id !== 'string') return null;
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  return row ? toProduct(row) : null;
}

function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const insertChange = (db: DatabaseSync, productId: string, at: Instant, kind: string, before: unknown, after: unknown) =>
  db
    .prepare(
      `INSERT INTO product_changes (product_id, at, kind, actor, before, after) VALUES (?, ?, ?, 'user', ?, ?)`,
    )
    .run(productId, at.epochMilliseconds, kind, before === null ? null : JSON.stringify(before), JSON.stringify(after));

export function createProduct(db: DatabaseSync, input: Record<string, unknown>, at: Instant, params: Params): Result {
  const v = validateNewProduct(input, params);
  if (!v.ok) return v;
  const id = randomUUID();
  const row = newProductRow(input, params);
  inTransaction(db, () => {
    db.prepare('INSERT INTO products (id, name, category, unit, minimum, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)').run(
      id,
      row.name,
      row.category,
      row.unit,
      row.minimum,
      at.epochMilliseconds,
    );
    insertChange(db, id, at, 'create', null, newProductAttrs(input));
  });
  return { ok: true, product: getProduct(db, id) as Product };
}

export function updateProduct(
  db: DatabaseSync,
  id: unknown,
  patch: Record<string, unknown>,
  at: Instant,
  params: Params,
): Result {
  const v = validateProductPatch(patch, params);
  if (!v.ok) return v;
  const current = getProduct(db, id);
  if (!current) return { ok: false, errors: [{ field: 'id' }] };
  const { before, after } = diffProduct(current, patch);
  const changed = Object.keys(after) as ProductField[];
  if (changed.length === 0) return { ok: true, product: current };
  inTransaction(db, () => {
    db.prepare(`UPDATE products SET ${changed.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(
      ...changed.map((f) => after[f] as string | number | null),
      current.id,
    );
    insertChange(db, current.id, at, 'update', before, after);
  });
  return { ok: true, product: getProduct(db, current.id) as Product };
}

export type StockEvent = StockFoldEvent & {
  productId: string;
  recordedAt: number;
};
type EventResult = { ok: true; event: StockEvent } | { ok: false; errors: { field: string }[] };

function toEvent(r: Record<string, unknown>): StockEvent {
  return {
    seq: r.seq as number,
    id: r.id as string,
    productId: r.product_id as string,
    type: r.type as StockEventType,
    qty: r.qty as number | null,
    occurredAt: r.occurred_at as number,
    recordedAt: r.recorded_at as number,
  };
}

export function getStockEvents(db: DatabaseSync, productId: string): StockEvent[] {
  return db.prepare('SELECT * FROM stock_events WHERE product_id = ? ORDER BY seq').all(productId).map(toEvent);
}

// BR-01: остаток — свёртка журнала на лету; null для несуществующей позиции.
export function getStock(db: DatabaseSync, productId: string) {
  return getProduct(db, productId) ? foldStock(getStockEvents(db, productId)) : null;
}

// T-002, T-003: запись события. Время события не позже now (П-1); количество по правилам домена (5.2).
export function recordStockEvent(db: DatabaseSync, input: Record<string, unknown>, now: Instant): EventResult {
  const v = validateStockEventInput(input);
  if (!v.ok) return v;
  const product = getProduct(db, input.productId);
  if (!product) return { ok: false, errors: [{ field: 'productId' }] };
  const occurred = input.occurredAt as Instant | undefined;
  const occurredAt = Math.min(occurred?.epochMilliseconds ?? Infinity, now.epochMilliseconds);
  const row = db
    .prepare(
      `INSERT INTO stock_events (id, product_id, type, qty, occurred_at, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(input.id as string, product.id, input.type as StockEventType, stockEventQty(input), occurredAt, now.epochMilliseconds);
  return { ok: true, event: toEvent(row as Record<string, unknown>) };
}
