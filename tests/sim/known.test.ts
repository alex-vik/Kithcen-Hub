import { describe, expect, it } from 'vitest';
import { createProduct } from '../../src/domain/catalog.ts';
import { createStockEvent, type StockEvent } from '../../src/domain/journal.ts';
import { systemBalanceAt } from './known.ts';
import { localToInstant } from './local-time.ts';

const p = createProduct({ id: 'x', name: 'x', unit: 'г', packName: 'уп', unitsPerPack: 900 });
if (!p.ok) throw new Error('профиль');
const mk = (id: string, seq: number, kind: 'purchase' | 'portion', quantity: number, occ: string, rec: string): StockEvent => {
  const r = createStockEvent(p.value, { id, seq, kind, quantity, occurredAt: occ, recordedAt: rec, source: 't' });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const events = [
  mk('buy', 1, 'purchase', 900, localToInstant('2026-10-12', '18:00'), localToInstant('2026-10-14', '09:00')),
  mk('use', 2, 'portion', 100, localToInstant('2026-10-12', '20:00'), localToInstant('2026-10-12', '20:00')),
];

describe('T-007 К9: срез знаний системы на момент T (ADR-003 §5.1)', () => {
  it('T-007 К9: во вторник покупку система ещё не знала — минус как есть (BR-15)', () => {
    expect(systemBalanceAt(events, localToInstant('2026-10-13', '23:59'))).toBe(-100);
  });
  it('T-007 К9: в среду покупка известна — 800', () => {
    expect(systemBalanceAt(events, localToInstant('2026-10-14', '23:59'))).toBe(800);
  });
  it('T-007 К9: порядок записи в массиве не влияет', () => {
    expect(systemBalanceAt([...events].reverse(), localToInstant('2026-10-13', '23:59'))).toBe(-100);
  });
});
