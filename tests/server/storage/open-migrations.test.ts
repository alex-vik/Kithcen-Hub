// T-004 К1–К4: открытие БД, настройки ADR-002, миграции (NFR-08, ADR-002, инвариант 1).
import { readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, mkProduct, nth, open, openFile, stock, tmpFile, T0 } from './helpers.ts';

afterEach(cleanup);

const MIGRATIONS_DIR = new URL('../../../src/server/storage/migrations/', import.meta.url);
function latestMigration(): number {
  const nums = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => Number(/^(\d+)/.exec(f)?.[1] ?? Number.NaN));
  if (nums.length === 0 || nums.some(Number.isNaN)) throw new Error('тест: файлы миграций вида NNNN_name.sql не найдены');
  return Math.max(...nums);
}
const userVersion = (db: DatabaseSync): number => Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
const tables = (db: DatabaseSync): string[] =>
  (db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all('table') as { name: string }[]).map((r) => r.name);

describe('T-004 К1: открытие БД с настройками ADR-002', () => {
  it('T-004 К1: файловая БД — wal, synchronous FULL, foreign_keys, busy_timeout из параметра', () => {
    const { storage } = openFile(5000);
    expect(storage.pragmas()).toMatchObject({ journalMode: 'wal', synchronous: 2, foreignKeys: 1, busyTimeoutMs: 5000 });
    storage.close();
  });

  it('T-004 К1: busy_timeout — параметр, а не константа', () => {
    const { storage } = openFile(1234);
    expect(storage.pragmas().busyTimeoutMs).toBe(1234);
    storage.close();
  });

  it('T-004 К1: :memory: — foreign_keys = 1 и применены те же миграции', () => {
    const s = open({ path: ':memory:', busyTimeoutMs: 5000 });
    expect(s.pragmas().foreignKeys).toBe(1);
    expect(s.pragmas().userVersion).toBe(latestMigration());
    s.close();
  });
});

describe('T-004 К1: busyTimeoutMs — целое не меньше 0', () => {
  it('T-004 К1: отрицательное, дробное, NaN, Infinity — исключение; 0 допустим', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => open({ path: ':memory:', busyTimeoutMs: bad }), String(bad)).toThrow();
    }
    const s = open({ path: ':memory:', busyTimeoutMs: 0 });
    expect(s.pragmas().busyTimeoutMs).toBe(0);
    s.close();
  });

  it('T-004 К1: при отказе файл БД не получает схему', () => {
    const path = tmpFile();
    expect(() => open({ path, busyTimeoutMs: -5 })).toThrow();
    const raw = new DatabaseSync(path);
    expect(userVersion(raw)).toBe(0);
    expect(tables(raw)).toEqual([]);
    raw.close();
  });
});

describe('T-004 К2: миграции на пустой БД, остатка в схеме нет', () => {
  it('T-004 К2 / T-010 Х1: user_version = номер последней миграции; STRICT-таблицы (после 0002 — и job_runs)', () => {
    const { storage, raw } = openFile();
    expect(userVersion(raw)).toBe(latestMigration());
    const list = (raw.prepare('PRAGMA table_list').all() as { schema: string; name: string; strict: number }[]).filter(
      (t) => t.schema === 'main' && !t.name.startsWith('sqlite_'),
    );
    expect(list.map((t) => t.name).sort()).toEqual(['job_runs', 'product', 'state_event', 'stock_event']);
    for (const t of list) expect(t.strict, t.name).toBe(1);
    storage.close();
  });

  it('T-004 К2: нет таблицы или столбца с остатком (инвариант 1)', () => {
    const { storage, raw } = openFile();
    for (const t of tables(raw)) {
      expect(t, 'имя таблицы').not.toMatch(/balance|remain|on_hand|остат/i);
      const cols = (raw.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
      for (const c of cols) expect(c, `${t}.${c}`).not.toMatch(/balance|remain|on_hand|остат/i);
    }
    storage.close();
  });
});

describe('T-004 К3: повторное открытие', () => {
  it('T-004 К3: версия та же, позиция и события читаются без изменений', () => {
    const path = tmpFile();
    const p = mkProduct('p-buckwheat', 'Гречка');
    const s1 = open({ path, busyTimeoutMs: 5000 });
    s1.addProduct(p);
    const e1 = stock(p, 'e-1', 'purchase', T0, { quantity: 1800 });
    const e2 = stock(p, 'e-2', 'portion', '2026-10-12T10:00:00.000Z', { quantity: 100 });
    const r1 = nth([s1.addStockEvent(e1), s1.addStockEvent(e2)], 0);
    const v = s1.pragmas().userVersion;
    const before = s1.listStockEvents(p.id);
    s1.close();

    const s2 = open({ path, busyTimeoutMs: 5000 });
    expect(s2.pragmas().userVersion).toBe(v);
    expect(s2.getProduct(p.id)).toStrictEqual(p);
    expect(s2.listStockEvents(p.id)).toStrictEqual(before);
    expect(before).toHaveLength(2);
    expect(r1.status).toBe('added');
    s2.close();
  });
});

describe('T-004 К4: сбой миграции откатывается целиком', () => {
  const m1 = 'CREATE TABLE t1 (a INTEGER) STRICT;';
  const bad2 = 'CREATE TABLE t2 (b INTEGER) STRICT; INSERT INTO no_such_table VALUES (1);';
  const good2 = 'CREATE TABLE t2 (b INTEGER) STRICT;';

  it('T-004 К4: ошибка во второй миграции — user_version 1, таблицы t2 нет; после исправления — версия 2', () => {
    const path = tmpFile();
    expect(() => open({ path, busyTimeoutMs: 5000, migrations: [m1, bad2] })).toThrow();

    const raw = new DatabaseSync(path);
    expect(userVersion(raw)).toBe(1);
    expect(tables(raw)).toContain('t1');
    expect(tables(raw)).not.toContain('t2');
    raw.close();

    const s = open({ path, busyTimeoutMs: 5000, migrations: [m1, good2] });
    expect(s.pragmas().userVersion).toBe(2);
    s.close();
    const raw2 = new DatabaseSync(path);
    expect(tables(raw2)).toEqual(expect.arrayContaining(['t1', 't2']));
    raw2.close();
  });
});
