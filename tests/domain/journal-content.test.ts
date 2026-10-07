// T-004 К30, К31: сравнение содержимого события при повторе (BR-26, ADR-003 §8; хвосты ревью T-003 п. 1, 2).
// К31, типовая часть: `npm run typecheck` падает, если в StockEvent появилось поле, которого нет ни в
// CONTENT_KEYS, ни среди seq/recordedAt (Exclude → never ниже), либо если образец Required<StockEvent> неполон.
import { describe, expect, it } from 'vitest';
import { createProduct } from '../../src/domain/catalog.ts';
import { CONTENT_KEYS, createStockEvent, resolveEventWrite } from '../../src/domain/journal.ts';
import type { StockEvent } from '../../src/domain/journal.ts';

const made = createProduct({ id: 'p-1', name: 'Гречка', unit: 'г', packName: 'пачка', unitsPerPack: 900 });
if (!made.ok) throw new Error('тест: createProduct');

describe('T-004 К30: конфликт по value инвентаризации', () => {
  it('T-004 К30: тот же id, value 500 против 480 — конфликт', () => {
    const mk = (value: number, seq: number, recordedAt: string) => {
      const r = createStockEvent(made.value, {
        id: 'inv-1', seq, kind: 'inventory', value, occurredAt: '2026-10-12T09:00:00.000Z', recordedAt, source: 'phone',
      });
      if (!r.ok) throw new Error('тест: createStockEvent');
      return r.value;
    };
    const recorded = mk(500, 3, '2026-10-12T09:00:05.000Z');
    const out = resolveEventWrite(recorded, mk(480, 9, '2026-10-12T09:00:40.000Z'));
    expect(out.outcome).toBe('conflict');
    expect(out.event).toEqual(recorded);
    expect(resolveEventWrite(recorded, mk(500, 9, '2026-10-12T09:00:40.000Z')).outcome).toBe('repeat');
  });
});

const sample: Required<StockEvent> = {
  id: 'e-1',
  seq: 1,
  productId: 'p-1',
  kind: 'purchase',
  quantity: 1800,
  value: 10,
  packs: 2,
  unitsPerPack: 900,
  targetId: 'e-0',
  occurredAt: '2026-10-12T09:00:00.000Z',
  recordedAt: '2026-10-12T09:00:05.000Z',
  source: 'phone',
};

type Uncovered = Exclude<keyof StockEvent, (typeof CONTENT_KEYS)[number] | 'seq' | 'recordedAt'>;
type Foreign = Exclude<(typeof CONTENT_KEYS)[number], keyof StockEvent>;
export const noUncoveredField: [Uncovered] extends [never] ? true : never = true;
export const noForeignKey: [Foreign] extends [never] ? true : never = true;

const changed = (key: keyof StockEvent): StockEvent => {
  const v = sample[key];
  const next = key === 'kind' ? 'recipe' : typeof v === 'number' ? v + 1 : `${String(v)}x`;
  return { ...sample, [key]: next } as StockEvent;
};

describe('T-004 К31: список полей содержимого полон', () => {
  it('T-004 К31: CONTENT_KEYS экспортирован и равен полям StockEvent без seq и recordedAt', () => {
    expect(CONTENT_KEYS, 'CONTENT_KEYS должен экспортироваться из src/domain/journal.ts').toBeDefined();
    expect([...CONTENT_KEYS].sort()).toEqual(
      (Object.keys(sample) as (keyof StockEvent)[]).filter((k) => k !== 'seq' && k !== 'recordedAt').sort(),
    );
  });

  it('T-004 К31: смена seq или recordedAt — повтор; смена любого другого поля — конфликт', () => {
    for (const key of Object.keys(sample) as (keyof StockEvent)[]) {
      const out = resolveEventWrite(sample, changed(key));
      expect(out.outcome, key).toBe(key === 'seq' || key === 'recordedAt' ? 'repeat' : 'conflict');
    }
  });
});
