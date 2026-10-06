// Помощники хранения (T-001): база :memory: на тест (ADR-002).
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/server/db/index.ts';

// ADR-002: новая :memory: база на тест, те же миграции, что в проде.
export function newDb(): DatabaseSync {
  return openDb(':memory:');
}

export type Row = Record<string, unknown>;

export function rows(db: DatabaseSync, sql: string, ...args: (string | number | null)[]): Row[] {
  return db.prepare(sql).all(...args).map((r) => ({ ...r }));
}

export function changesOf(db: DatabaseSync, productId: unknown): Row[] {
  return rows(db, 'SELECT * FROM product_changes WHERE product_id = ? ORDER BY id', productId as string | number);
}

export function count(db: DatabaseSync, table: 'products' | 'product_changes' | 'stock_events'): number {
  return (rows(db, `SELECT COUNT(*) AS n FROM ${table}`)[0] as { n: number }).n;
}
