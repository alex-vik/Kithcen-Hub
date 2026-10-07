// T-012 Х1–Х2: миграция 0003 и таблица absence_period, только добавление (FR-ABS-01, BR-02).
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, count, mkProduct, nth, open, openFile, stock, tmpFile, T0 } from './helpers.ts';
import type { StorageApi } from './helpers.ts';

afterEach(cleanup);
type Period = { id: string; start: string; end: string; recordedAt: string };
type Abs = StorageApi & {
  addAbsencePeriod(p: Period): { status: 'added' | 'exists'; period: Period };
  listAbsencePeriods(): Period[];
};
const mig = (n: string): string => readFileSync(new URL(`../../../src/server/storage/migrations/${n}`, import.meta.url), 'utf8');
const userVersion = (db: DatabaseSync): number => Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
const REC = '2026-10-15T06:00:00.000Z';
const per = (id: string, start: string, end: string): Period => ({ id, start, end, recordedAt: REC });

describe('T-012 Х1: миграция 0003_absence_period', () => {
  it('T-012 Х1: БД на версии 2 с данными → версия 3, таблица есть, каталог, журнал и job_runs не изменились', () => {
    const path = tmpFile();
    const v2 = open({ path, busyTimeoutMs: 5000, migrations: [mig('0001_init.sql'), mig('0002_job_runs.sql')] });
    const p = mkProduct('p1', 'Кофе');
    v2.addProduct(p);
    v2.addStockEvent(stock(p, 'e-1', 'purchase', T0, { quantity: 500 }));
    (v2 as unknown as { markJobDay(j: string, d: string): void }).markJobDay('auto_writeoff', '2026-10-11');
    const before = { products: v2.listProducts(), events: v2.listStockEvents('p1') };
    v2.close();
    const raw0 = new DatabaseSync(path);
    expect(userVersion(raw0)).toBe(2);
    raw0.close();

    const s = open({ path, busyTimeoutMs: 5000 });
    expect(s.pragmas().userVersion).toBe(3);
    expect({ products: s.listProducts(), events: s.listStockEvents('p1') }).toEqual(before);
    expect((s as unknown as { lastJobDay(j: string): string | undefined }).lastJobDay('auto_writeoff')).toBe('2026-10-11');
    s.close();
    const raw = new DatabaseSync(path);
    const cols = raw.prepare('PRAGMA table_info(absence_period)').all() as { name: string; pk: number }[];
    expect(cols.map((c) => c.name).sort()).toEqual(['end_day', 'id', 'recorded_at', 'start_day']);
    expect(cols.filter((c) => c.pk > 0).map((c) => c.name)).toEqual(['id']);
    raw.close();
  });

  it('T-012 Х1: новая пустая БД — версия 3, absence_period пуста и STRICT', () => {
    const { storage, raw } = openFile();
    expect(storage.pragmas().userVersion).toBe(3);
    expect(count(raw, 'absence_period')).toBe(0);
    const t = (raw.prepare('PRAGMA table_list').all() as { name: string; strict: number }[]).find((x) => x.name === 'absence_period');
    expect(t?.strict).toBe(1);
    storage.close();
  });
});

describe('T-012 Х2: addAbsencePeriod / listAbsencePeriods', () => {
  it('T-012 Х2: пусто; после добавления — порядок по start_day, поля те же', () => {
    const { storage } = openFile();
    const s = storage as Abs;
    expect(s.listAbsencePeriods()).toEqual([]);
    for (const p of [per('a', '2026-10-20', '2026-10-20'), per('c', '2026-10-10', '2026-10-13'), per('b', '2026-10-12', '2026-10-15')]) {
      expect(s.addAbsencePeriod(p)).toEqual({ status: 'added', period: p });
    }
    expect(s.listAbsencePeriods()).toEqual([
      per('c', '2026-10-10', '2026-10-13'), per('b', '2026-10-12', '2026-10-15'), per('a', '2026-10-20', '2026-10-20'),
    ]);
  });

  it('T-012 Х2: порядок при равных start_day — по id', () => {
    const { storage } = openFile();
    const s = storage as Abs;
    s.addAbsencePeriod(per('z', '2026-10-10', '2026-10-11'));
    s.addAbsencePeriod(per('m', '2026-10-10', '2026-10-12'));
    expect(s.listAbsencePeriods().map((p) => p.id)).toEqual(['m', 'z']);
  });

  it('T-012 Х2: повтор id с другими датами — exists с первоначальным периодом, строк не прибавилось', () => {
    const { storage, raw } = openFile();
    const s = storage as Abs;
    const first = per('a', '2026-10-10', '2026-10-13');
    expect(s.addAbsencePeriod(first).status).toBe('added');
    const r = s.addAbsencePeriod({ ...per('a', '2026-11-01', '2026-11-05'), recordedAt: '2026-11-06T00:00:00.000Z' });
    expect(r).toEqual({ status: 'exists', period: first });
    expect(count(raw, 'absence_period')).toBe(1);
    expect(nth(s.listAbsencePeriods(), 0)).toEqual(first);
  });

  it('T-012 Х2: UPDATE, DELETE и INSERT OR REPLACE по существующему id отклоняются триггерами', () => {
    const { storage, raw } = openFile();
    (storage as Abs).addAbsencePeriod(per('a', '2026-10-10', '2026-10-13'));
    expect(() => raw.exec("UPDATE absence_period SET end_day = '2026-10-30' WHERE id = 'a'")).toThrow(/append-only/);
    expect(() => raw.exec("DELETE FROM absence_period WHERE id = 'a'")).toThrow(/append-only/);
    expect(() => raw.exec(
      "INSERT OR REPLACE INTO absence_period (id, start_day, end_day, recorded_at) VALUES ('a', '2026-12-01', '2026-12-02', '2026-12-03T00:00:00.000Z')",
    )).toThrow(/append-only/);
    expect((storage as Abs).listAbsencePeriods()).toEqual([per('a', '2026-10-10', '2026-10-13')]);
  });

  it('T-012 Х2: добавление в transaction, откатанной исключением, строки не оставляет', () => {
    const { storage, raw } = openFile();
    const s = storage as Abs;
    expect(() => s.transaction(() => {
      s.addAbsencePeriod(per('a', '2026-10-10', '2026-10-13'));
      throw new Error('откат (тест)');
    })).toThrow('откат (тест)');
    expect(count(raw, 'absence_period')).toBe(0);
    expect(s.listAbsencePeriods()).toEqual([]);
  });
});
