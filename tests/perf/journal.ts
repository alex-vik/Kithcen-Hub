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
/** T-009 К16-доп.1: период журнала один для всех позиций (год), события позиции разложены по нему равномерно. */
const PERIOD_MIN = 365 * 24 * 60;

const int = (r: { next(): number }, from: number, to: number): number => from + Math.floor(r.next() * (to - from + 1));

/** Число событий на позицию: ритмичные чаще; сумма точно равна total. */
function counts(total: number): number[] {
  const weights = Array.from({ length: PERF.products }, (_, i) => (i < PERF.rhythmic ? 2 : 0.7));
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map((w) => Math.floor((total * w) / sum));
  let rest = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % out.length, rest--) out[i] = (out[i] as number) + 1;
  return out;
}

type Draft = { p: number; i: number; ms: number; input: Omit<StockEventInput, 'seq'> };

/** Доли видов событий по накопленной границе: [граница, вид]. ADR-003 §1: у ритмичных автосписания — большинство. */
const MIX_RHYTHMIC: ReadonlyArray<readonly [number, string]> = [
  [0.07, 'purchase'], [0.78, 'auto_writeoff'], [0.83, 'portion'], [0.89, 'recipe'],
  [0.91, 'spoilage'], [0.95, 'inventory'], [0.97, 'depleted'], [1, 'cancel'],
];
const MIX_OTHER: ReadonlyArray<readonly [number, string]> = [
  [0.10, 'purchase'], [0.61, 'portion'], [0.76, 'recipe'], [0.81, 'spoilage'],
  [0.91, 'inventory'], [0.96, 'depleted'], [1, 'cancel'],
];

/**
 * Входы строятся по позициям, затем все события сортируются по recordedAt (тай-брейк — номер позиции, затем номер
 * внутри позиции), seq назначается в этом порядке и события создаются через createStockEvent. Так строки позиции
 * чередуются на диске так же, как в реальном журнале; цель отмены внутри позиции всегда раньше (seq меньше).
 */
export function generateJournal(seed: number, totalEvents: number): Journal {
  const rng = createRng(seed);
  const perProduct = counts(totalEvents);
  const products: Product[] = [];
  const drafts: Draft[] = [];

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
    products.push(made.value);

    const mix = rhythmic ? MIX_RHYTHMIC : MIX_OTHER;
    const mine: Draft[] = [];
    const total = perProduct[p] as number;
    for (let i = 0; i < total; i++) {
      // Расслоенная выборка: i-е событие — в i-й доле периода; первое и последнее события позиции — на краях периода.
      const t = START_MS + Math.floor(((i + rng.next()) * PERIOD_MIN) / total) * MINUTE;
      const occurredMs = rng.next() < 0.03 ? t - int(rng, 1, 2880) * MINUTE : t;
      const base = {
        id: `e-${id}-${i}`, occurredAt: new Date(occurredMs).toISOString(), recordedAt: new Date(t).toISOString(), source: 'perf',
      };
      const x = rng.next();
      const kind = mine.length === 0 ? 'purchase' : (mix.find(([bound]) => x < bound) as readonly [number, string])[1];
      let input: Draft['input'];
      switch (kind) {
        case 'purchase':
          input = rng.next() < 0.5
            ? { ...base, kind: 'purchase', packs: int(rng, 1, 3) }
            : { ...base, kind: 'purchase', quantity: int(rng, 50, 1000) };
          break;
        case 'inventory':
          input = { ...base, kind: 'inventory', value: int(rng, 0, 1000) };
          break;
        case 'depleted':
          input = { ...base, kind: 'depleted' };
          break;
        case 'cancel': {
          // Отмена среди последних 50 событий позиции; в 30% случаев — отмена отмены, если такая цель есть.
          const window = mine.slice(-50);
          const cancels = window.filter((d) => d.input.kind === 'cancel');
          const pool = rng.next() < 0.3 && cancels.length > 0 ? cancels : window;
          input = { ...base, kind: 'cancel', targetId: (pool[int(rng, 0, pool.length - 1)] as Draft).input.id };
          break;
        }
        default: {
          const range = kind === 'auto_writeoff' || kind === 'portion' ? [1, 100] : [10, 300];
          input = { ...base, kind: kind as 'portion', quantity: int(rng, range[0] as number, range[1] as number) };
        }
      }
      const d: Draft = { p, i, ms: t, input };
      mine.push(d);
      drafts.push(d);
    }
  }

  drafts.sort((a, b) => a.ms - b.ms || a.p - b.p || a.i - b.i);
  const events: StockEvent[] = [];
  drafts.forEach((d, k) => {
    const input = { ...d.input, seq: k + 1 } as StockEventInput;
    const r = createStockEvent(products[d.p] as Product, input);
    if (!r.ok) throw new Error(`createStockEvent отказал: ${JSON.stringify(input)} — ${r.error.attribute}: ${r.error.message}`);
    events.push(r.value);
  });
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

/**
 * T-009 К16-доп.3: вход пути (а) — новые объекты событий, созданные подряд по позиции (как при чтении журнала
 * по позиции), а не те же ссылки, что в журнале и в общей куче генерации. Значения равны (toEqual).
 */
export function freshEventsByProduct(journal: Journal): Map<string, StockEvent[]> {
  const out = new Map<string, StockEvent[]>();
  for (const [id, list] of groupByProduct(journal.events)) out.set(id, list.map((e) => ({ ...e })));
  return out;
}

/** Вставка в порядке seq (по recordedAt) одной транзакцией; seq хранилища совпадает с seq генератора. */
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
