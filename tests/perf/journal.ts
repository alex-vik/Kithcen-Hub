// T-008 К16-К18: синтетический журнал и два пути расчёта остатков (BR-01, ADR-003 §1, §3).
// Случайность — только createRng (НВ-6 а); события — только через createStockEvent (Р2).
import { createProduct } from '../../src/domain/catalog.ts';
import type { Product } from '../../src/domain/catalog.ts';
import { createStockEvent, stockBalance } from '../../src/domain/journal.ts';
import type { StockEvent, StockEventInput } from '../../src/domain/journal.ts';
import type { Storage } from '../../src/server/storage/index.ts';
import { createRng } from '../sim/rng.ts';
import { PERF } from './config.ts';

export type Journal = { products: Product[]; events: StockEvent[] };

const START_MS = Date.UTC(2024, 0, 1);
const MINUTE = 60_000;

const int = (r: { next(): number }, from: number, to: number): number => from + Math.floor(r.next() * (to - from + 1));

/** Число событий на позицию: ритмичные чаще; сумма точно равна total. */
function counts(total: number): number[] {
  const weights = Array.from({ length: PERF.products }, (_, i) => (i < PERF.rhythmic ? 1.5 : 0.8));
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.floor((total * w) / sum));
  let rest = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % out.length, rest--) out[i] = (out[i] as number) + 1;
  return out;
}

export function generateJournal(seed: number, totalEvents: number): Journal {
  const rng = createRng(seed);
  const perProduct = counts(totalEvents);
  const products: Product[] = [];
  const events: StockEvent[] = [];
  let seq = 0;

  for (let p = 0; p < PERF.products; p++) {
    const id = `p${String(p).padStart(3, '0')}`;
    const rhythmic = p < PERF.rhythmic;
    const made = createProduct({
      id,
      name: `Позиция ${id}`,
      writeOffType: rhythmic ? 'rhythmic' : p % 2 === 0 ? 'burst' : 'slow',
      unit: 'г',
      packName: 'уп.',
      unitsPerPack: 100 * int(rng, 1, 10),
    });
    if (!made.ok) throw new Error(`позиция ${id}: ${made.error.attribute} ${made.error.message}`);
    const product = made.value;
    products.push(product);

    const mine: StockEvent[] = [];
    let t = START_MS + int(rng, 0, 600) * MINUTE;
    for (let i = 0; i < (perProduct[p] as number); i++) {
      t += int(rng, 1, 120) * MINUTE;
      const occurredMs = rng.next() < 0.03 ? t - int(rng, 1, 2880) * MINUTE : t;
      const occurredAt = new Date(occurredMs).toISOString();
      const eventId = `e-${id}-${i}`;
      const base = { id: eventId, seq: ++seq, occurredAt, recordedAt: new Date(t).toISOString(), source: 'perf' };
      const x = rng.next();
      let input: StockEventInput;
      if (x < 0.08 || mine.length === 0) {
        input = rng.next() < 0.5
          ? { ...base, kind: 'purchase', packs: int(rng, 1, 3) }
          : { ...base, kind: 'purchase', quantity: int(rng, 50, 1000) };
      } else if (x < 0.5) {
        input = { ...base, kind: rhythmic ? 'auto_writeoff' : 'portion', quantity: int(rng, 1, 100) };
      } else if (x < 0.58) {
        input = { ...base, kind: 'recipe', quantity: int(rng, 10, 300) };
      } else if (x < 0.62) {
        input = { ...base, kind: 'spoilage', quantity: int(rng, 10, 300) };
      } else if (x < 0.70) {
        input = { ...base, kind: 'inventory', value: int(rng, 0, 1000) };
      } else if (x < 0.74) {
        input = { ...base, kind: 'depleted' };
      } else {
        // Отмена среди последних 50 событий; в 30% случаев — отмена отмены, если такая цель есть.
        const window = mine.slice(-50);
        const cancels = window.filter((e) => e.kind === 'cancel');
        const pool = rng.next() < 0.3 && cancels.length > 0 ? cancels : window;
        input = { ...base, kind: 'cancel', targetId: (pool[int(rng, 0, pool.length - 1)] as StockEvent).id };
      }
      const r = createStockEvent(product, input);
      if (!r.ok) throw new Error(`createStockEvent отказал: ${JSON.stringify(input)} — ${r.error.attribute}: ${r.error.message}`);
      mine.push(r.value);
      events.push(r.value);
    }
  }
  return { products, events };
}

export function groupByProduct(events: readonly StockEvent[]): Map<string, StockEvent[]> {
  const m = new Map<string, StockEvent[]>();
  for (const e of events) {
    const list = m.get(e.productId);
    if (list) list.push(e);
    else m.set(e.productId, [e]);
  }
  return m;
}

/** Вставка в порядке генерации одной транзакцией; seq хранилища совпадает с seq генератора. */
export function loadIntoStorage(storage: Storage, journal: Journal): void {
  storage.transaction(() => {
    for (const p of journal.products) {
      if (storage.addProduct(p).status !== 'added') throw new Error(`позиция ${p.id} не добавлена`);
    }
    for (const e of journal.events) {
      const r = storage.addStockEvent(e);
      if (r.status !== 'added') throw new Error(`событие ${e.id} не добавлено: ${JSON.stringify(r)}`);
    }
  });
}

/** Путь (а): события уже в памяти, сгруппированы по позициям. */
export function balancesInMemory(grouped: ReadonlyMap<string, readonly StockEvent[]>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, list] of grouped) out.set(id, stockBalance(list));
  return out;
}

/** Путь (б): listProducts + listStockEvents по каждой позиции + stockBalance. */
export function balancesViaStorage(storage: Storage): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of storage.listProducts()) out.set(p.id, stockBalance(storage.listStockEvents(p.id)));
  return out;
}

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

export function percentile(xs: readonly number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] as number;
}
