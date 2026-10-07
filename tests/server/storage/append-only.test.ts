// T-004 К5, К6, К15 (прямой SQL): защита журналов на уровне БД (BR-02, NFR-08, NFR-14, ADR-002).
// «Прямой SQL» — отдельное соединение к тому же файлу в обход хранилища.
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { StateEvent } from '../../../src/domain/catalog.ts';
import type { StockEvent } from '../../../src/domain/journal.ts';
import { added, cleanup, count, mkProduct, nth, openFile, state, stock, T0 } from './helpers.ts';

afterEach(cleanup);

type Row = Record<string, unknown>;
const rowsOf = (raw: DatabaseSync, table: string, id: string): Row[] =>
  (raw.prepare(`SELECT * FROM ${table} WHERE id = ?`).all(id) as Row[]).map((r) => ({ ...r }));

/** Выполнить; ошибка допустима (это и есть защита), исключений наружу нет. */
function attempt(raw: DatabaseSync, sql: string, ...params: (string | number | null)[]): void {
  try {
    raw.prepare(sql).run(...params);
  } catch {
    /* защита сработала */
  }
}

function replaceWith(raw: DatabaseSync, table: string, row: Row, patch: Row): void {
  const next = { ...row, ...patch };
  const cols = Object.keys(next);
  attempt(
    raw,
    `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    ...cols.map((c) => next[c] as string | number | null),
  );
}

describe('T-004 К5: журнал остатка нельзя изменить даже прямым SQL', () => {
  it('T-004 К5: UPDATE, DELETE, INSERT OR REPLACE не меняют строку порции −100', () => {
    const { storage, raw } = openFile();
    const p = mkProduct('p-buckwheat', 'Гречка');
    storage.addProduct(p);
    const e = added(storage.addStockEvent(stock(p, 'e-1', 'portion', T0, { quantity: 100 })));
    const before = rowsOf(raw, 'stock_event', e.id);
    expect(before).toHaveLength(1);

    const attempts: Array<[string, () => void]> = [
      ['UPDATE quantity', () => attempt(raw, 'UPDATE stock_event SET quantity = 999 WHERE id = ?', e.id)],
      ['UPDATE occurred_at', () => attempt(raw, 'UPDATE stock_event SET occurred_at = ? WHERE id = ?', '2026-10-13T09:00:00.000Z', e.id)],
      ['UPDATE kind', () => attempt(raw, 'UPDATE stock_event SET kind = ? WHERE id = ?', 'recipe', e.id)],
      ['DELETE по id', () => attempt(raw, 'DELETE FROM stock_event WHERE id = ?', e.id)],
      ['DELETE всего', () => attempt(raw, 'DELETE FROM stock_event')],
      ['INSERT OR REPLACE тот же id и seq', () => replaceWith(raw, 'stock_event', nth(before, 0), { quantity: 999 })],
      ['INSERT OR REPLACE тот же id, новый seq', () => replaceWith(raw, 'stock_event', nth(before, 0), { seq: e.seq + 100, quantity: 999 })],
      ['INSERT OR REPLACE новый id, существующий seq', () => replaceWith(raw, 'stock_event', nth(before, 0), { id: 'e-new', quantity: 999 })],
    ];
    for (const [name, run] of attempts) {
      run();
      expect(rowsOf(raw, 'stock_event', e.id), name).toStrictEqual(before);
      expect(count(raw, 'stock_event'), name).toBe(1);
    }
    expect(storage.getStockEvent(e.id)).toStrictEqual(e);
    storage.close();
  });
});

describe('T-004 К6: журнал состояний защищён так же', () => {
  it('T-004 К6: UPDATE, DELETE, INSERT OR REPLACE не меняют событие inactive/user_button', () => {
    const { storage, raw } = openFile();
    const p = mkProduct('p-kefir', 'Кефир', 'мл', 1000);
    storage.addProduct(p);
    const s = added(storage.addStateEvent(state(p.id, 's-1', T0, 'inactive', 'user_button')));
    const before = rowsOf(raw, 'state_event', s.id);
    expect(before).toHaveLength(1);

    const attempts: Array<[string, () => void]> = [
      ['UPDATE state', () => attempt(raw, 'UPDATE state_event SET state = ? WHERE id = ?', 'active', s.id)],
      ['UPDATE reason', () => attempt(raw, 'UPDATE state_event SET reason = ? WHERE id = ?', 'purchase', s.id)],
      ['UPDATE occurred_at', () => attempt(raw, 'UPDATE state_event SET occurred_at = ? WHERE id = ?', '2026-10-13T09:00:00.000Z', s.id)],
      ['DELETE по id', () => attempt(raw, 'DELETE FROM state_event WHERE id = ?', s.id)],
      ['DELETE всего', () => attempt(raw, 'DELETE FROM state_event')],
      ['INSERT OR REPLACE тот же id и seq', () => replaceWith(raw, 'state_event', nth(before, 0), { state: 'active', reason: 'user_restore' })],
      ['INSERT OR REPLACE тот же id, новый seq', () => replaceWith(raw, 'state_event', nth(before, 0), { seq: s.seq + 100, state: 'active', reason: 'user_restore' })],
      ['INSERT OR REPLACE новый id, существующий seq', () => replaceWith(raw, 'state_event', nth(before, 0), { id: 's-new', state: 'active', reason: 'user_restore' })],
    ];
    for (const [name, run] of attempts) {
      run();
      expect(rowsOf(raw, 'state_event', s.id), name).toStrictEqual(before);
      expect(count(raw, 'state_event'), name).toBe(1);
    }
    expect(storage.listStateEvents(p.id)).toStrictEqual([s]);
    storage.close();
  });
});

const BAD_TIMES = ['2026-10-12T09:00:00Z', '2026-10-12T12:00:00.000+03:00', '2026-10-12 09:00:00.000Z'];

describe('T-004 К15: время в хранилище только в каноне', () => {
  it('T-004 К15: события остатка с неканоническим временем отклоняются хранилищем', () => {
    const { storage, raw } = openFile();
    const p = mkProduct('p-buckwheat', 'Гречка');
    storage.addProduct(p);
    let n = 0;
    for (const field of ['occurredAt', 'recordedAt'] as const) {
      for (const bad of BAD_TIMES) {
        const ev = { ...stock(p, `bad-${n++}`, 'portion', T0, { quantity: 100 }), [field]: bad } as unknown as StockEvent;
        expect(storage.addStockEvent(ev), `${field}=${bad}`).toStrictEqual({ status: 'rejected', reason: 'invalid_time' });
      }
    }
    expect(count(raw, 'stock_event')).toBe(0);
    storage.close();
  });

  it('T-004 К15: события состояния с неканоническим временем отклоняются хранилищем', () => {
    const { storage, raw } = openFile();
    const p = mkProduct('p-kefir', 'Кефир', 'мл', 1000);
    storage.addProduct(p);
    let n = 0;
    for (const field of ['occurredAt', 'recordedAt'] as const) {
      for (const bad of BAD_TIMES) {
        const ev = { ...state(p.id, `bad-${n++}`, T0, 'inactive', 'user_button'), [field]: bad } as unknown as StateEvent;
        expect(storage.addStateEvent(ev), `${field}=${bad}`).toStrictEqual({ status: 'rejected', reason: 'invalid_time' });
      }
    }
    expect(count(raw, 'state_event')).toBe(0);
    storage.close();
  });

  it('T-004 К15: прямой SQL с неканоническим временем падает, а такая же вставка с каноном проходит', () => {
    const { storage, raw } = openFile();
    const p = mkProduct('p-buckwheat', 'Гречка');
    storage.addProduct(p);
    added(storage.addStockEvent(stock(p, 'e-0', 'portion', T0, { quantity: 100 })));
    added(storage.addStateEvent(state(p.id, 's-0', T0, 'inactive', 'user_button')));

    for (const table of ['stock_event', 'state_event']) {
      const tpl = { ...(raw.prepare(`SELECT * FROM ${table} LIMIT 1`).get() as Row) };
      const insert = (patch: Row): void => {
        const row = { ...tpl, ...patch };
        const cols = Object.keys(row);
        raw
          .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .run(...cols.map((c) => row[c] as string | number | null));
      };
      const nextSeq = Number(tpl['seq']) + 100;
      // контроль: остальные столбцы вставки корректны
      expect(() => insert({ id: `${table}-ok`, seq: nextSeq }), `${table}: контроль`).not.toThrow();
      let n = 1;
      for (const col of ['occurred_at', 'recorded_at']) {
        for (const bad of BAD_TIMES) {
          expect(() => insert({ id: `${table}-${n}`, seq: nextSeq + n, [col]: bad }), `${table}.${col}=${bad}`).toThrow();
          n++;
        }
      }
      expect(count(raw, table), table).toBe(2);
    }
    storage.close();
  });
});
