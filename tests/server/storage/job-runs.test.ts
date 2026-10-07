// T-010 Х1–Х2: миграция 0002 и курсор job_runs (FR-CON-08, ADR-005, инвариант 1).
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, count, mkProduct, nth, open, openFile, stock, tmpFile, T0 } from './helpers.ts';
import type { StorageApi } from './helpers.ts';

afterEach(cleanup);
type Jobs = StorageApi & { lastJobDay(job: string): string | undefined; markJobDay(job: string, day: string): void };
const MIG1 = readFileSync(new URL('../../../src/server/storage/migrations/0001_init.sql', import.meta.url), 'utf8');
const latestMigration = (): number =>
  Math.max(...readdirSync(new URL('../../../src/server/storage/migrations/', import.meta.url))
    .filter((f) => f.endsWith('.sql')).map((f) => Number(/^(\d+)/.exec(f)?.[1] ?? Number.NaN)));
const userVersion = (db: DatabaseSync): number => Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);

describe('T-010 Х1: миграция 0002_job_runs', () => {
  it('T-010 Х1: БД на версии 1 с данными → версия 3 (T-012: добавилась 0003), job_runs есть, каталог и журнал не изменились', () => {
    const path = tmpFile();
    const v1 = open({ path, busyTimeoutMs: 5000, migrations: [MIG1] });
    const p = mkProduct('p1', 'Кофе');
    v1.addProduct(p);
    const e = stock(p, 'e-1', 'purchase', T0, { quantity: 500 });
    v1.addStockEvent(e);
    const before = { products: v1.listProducts(), events: v1.listStockEvents('p1') };
    v1.close();

    const raw0 = new DatabaseSync(path);
    expect(userVersion(raw0)).toBe(1);
    raw0.close();

    const s = open({ path, busyTimeoutMs: 5000 });
    expect(s.pragmas().userVersion).toBe(latestMigration());
    expect({ products: s.listProducts(), events: s.listStockEvents('p1') }).toEqual(before);
    s.close();
    const raw = new DatabaseSync(path);
    const cols = (raw.prepare('PRAGMA table_info(job_runs)').all() as { name: string; pk: number }[]);
    expect(cols.map((c) => c.name).sort()).toEqual(['day', 'job']);
    expect(cols.every((c) => c.pk > 0)).toBe(true);
    raw.close();
  });

  it('T-010 Х1: новая пустая БД — версия 3 (T-012) и таблица job_runs', () => {
    const { storage, raw } = openFile();
    expect(storage.pragmas().userVersion).toBe(latestMigration());
    expect(count(raw, 'job_runs')).toBe(0);
    storage.close();
  });
});

describe('T-010 Х2: lastJobDay / markJobDay', () => {
  it('T-010 Х2: пусто — undefined; максимум по day независимо от порядка отметок', () => {
    const { storage } = openFile();
    const s = storage as Jobs;
    expect(s.lastJobDay('auto_writeoff')).toBeUndefined();
    s.markJobDay('auto_writeoff', '2026-10-05');
    s.markJobDay('auto_writeoff', '2026-10-07');
    s.markJobDay('auto_writeoff', '2026-10-06');
    expect(s.lastJobDay('auto_writeoff')).toBe('2026-10-07');
  });

  it('T-010 Х2: повтор той же пары не бросает и не создаёт второй строки', () => {
    const { storage, raw } = openFile();
    const s = storage as Jobs;
    s.markJobDay('auto_writeoff', '2026-10-05');
    expect(() => s.markJobDay('auto_writeoff', '2026-10-05')).not.toThrow();
    expect(count(raw, 'job_runs')).toBe(1);
  });

  it('T-010 Х2: строки другой задачи на результат не влияют', () => {
    const { storage } = openFile();
    const s = storage as Jobs;
    s.markJobDay('auto_writeoff', '2026-10-05');
    s.markJobDay('other', '2026-12-31');
    expect(s.lastJobDay('auto_writeoff')).toBe('2026-10-05');
    expect(s.lastJobDay('other')).toBe('2026-12-31');
    expect(s.lastJobDay('third')).toBeUndefined();
  });

  it('T-010 Х2: markJobDay в транзакции, откаченной исключением, строки не оставляет', () => {
    const { storage, raw } = openFile();
    const s = storage as Jobs;
    expect(() => s.transaction(() => { s.markJobDay('auto_writeoff', '2026-10-05'); throw new Error('откат'); })).toThrow('откат');
    expect(count(raw, 'job_runs')).toBe(0);
    expect(s.lastJobDay('auto_writeoff')).toBeUndefined();
    s.transaction(() => { s.markJobDay('auto_writeoff', '2026-10-06'); });
    expect(nth([s.lastJobDay('auto_writeoff')], 0)).toBe('2026-10-06');
  });
});
