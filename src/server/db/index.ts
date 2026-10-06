// Хранение (ADR-002): openDb, миграции, каталог позиций (T-001, ADR-003 раздел 4).
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { diffProduct, newProductAttrs, productFields, validateNewProduct, validateProductPatch } from '../../domain/index.ts';
import type { Params, Product, ProductField } from '../../domain/index.ts';

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

// Поле домена → колонка. Порядок — порядок атрибутов карточки.
const columns: Record<ProductField, string> = {
  name: 'name',
  category: 'category',
  writeOffType: 'write_off_type',
  consumptionUnit: 'consumption_unit',
  packageName: 'package_name',
  packageFactor: 'package_factor',
  norm: 'norm',
  lowStockThreshold: 'low_stock_threshold',
  portion: 'portion',
};
const fields = productFields;

type Instant = Temporal.Instant;
type Result = { ok: true; product: Product } | { ok: false; errors: { field: string }[] };

function toProduct(r: Record<string, unknown>): Product {
  return {
    id: r.id as string,
    name: r.name as string,
    category: r.category as string | null,
    writeOffType: r.write_off_type as string | null,
    consumptionUnit: r.consumption_unit as string,
    packageName: r.package_name as string | null,
    packageFactor: r.package_factor as number | null,
    norm: r.norm as number | null,
    lowStockThreshold: r.low_stock_threshold as number | null,
    portion: r.portion as number | null,
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
  const values = Object.fromEntries(fields.map((f) => [f, input[f] ?? null]));
  const id = randomUUID();
  inTransaction(db, () => {
    db.prepare(
      `INSERT INTO products (id, ${fields.map((f) => columns[f]).join(', ')}, active, created_at)
       VALUES (?, ${fields.map(() => '?').join(', ')}, 1, ?)`,
    ).run(id, ...fields.map((f) => values[f] as string | number | null), at.epochMilliseconds);
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
    db.prepare(`UPDATE products SET ${changed.map((f) => `${columns[f]} = ?`).join(', ')} WHERE id = ?`).run(
      ...changed.map((f) => after[f] as string | number | null),
      current.id,
    );
    insertChange(db, current.id, at, 'update', before, after);
  });
  return { ok: true, product: getProduct(db, current.id) as Product };
}
