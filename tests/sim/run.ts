// T-007: прогон сценария. Реальность (T-006) -> закупки политики -> отметки модели -> события домена (Р1, Р2).
// Остаток системы считает только домен; реальный остаток считает прогон и он не бывает отрицательным.
import { createProduct, type Product } from '../../src/domain/catalog.ts';
import { createStockEvent, type StockEvent, type StockEventInput } from '../../src/domain/journal.ts';
import type { Instant, LocalDate } from '../../src/domain/time.ts';
import { DEFAULT_SEED, PERIOD_DAYS, PERIOD_START } from './config.ts';
import { computeG1, type G1Result, type PurchaseMark, type UnmetEntry } from './g1.ts';
import { systemBalanceAt } from './known.ts';
import { addDays, localToInstant } from './local-time.ts';
import { idealUser, type Mark, type MarkModel, type RealEvent } from './marks.ts';
import type { PurchasePolicy, RealityView } from './policies.ts';
import type { HomeProfile } from './profile.ts';
import { generateReality, type ConsumptionFact } from './reality.ts';
import { PURCHASE } from './run-config.ts';

export type RunOptions = {
  profile: Pick<HomeProfile, 'products'>;
  policy: PurchasePolicy;
  marks?: MarkModel;
  seed?: number;
  startDate?: LocalDate;
  days?: number;
  /** Свои факты (ручные сценарии); по умолчанию генератор T-006. */
  facts?: readonly ConsumptionFact[];
  /** Свои моменты закупки; по умолчанию purchaseSchedule. */
  schedule?: readonly Instant[];
  scenario?: string;
};

export type DayProduct = { demand: number; served: number; unmet: number; realEnd: number; knownEnd: number };
export type DayRecord = { date: LocalDate; products: Record<string, DayProduct> };
export type PurchaseRecord = PurchaseMark & { packs: number };

export type RunResult = {
  scenario: string;
  seed: number;
  startDate: LocalDate;
  days: number;
  policyLabel: string;
  markModel: string;
  productIds: string[];
  events: StockEvent[];
  purchases: PurchaseRecord[];
  unmet: UnmetEntry[];
  daily: DayRecord[];
  /** Остаток системы минус реальный на конец каждых местных суток по каждой позиции. */
  divergence: { date: LocalDate; productId: string; diff: number }[];
  minRealStock: number;
};

const weekdayOf = (d: LocalDate): number => new Date(`${d}T00:00:00Z`).getUTCDay();

/** Моменты закупки: в начале периода (FR-CAT-07, К7 «до первого расхода») и по субботам в 11:00 (Q-16). */
export function purchaseSchedule(startDate: LocalDate, days: number, initialStocking = true): Instant[] {
  const out: Instant[] = [];
  if (initialStocking) out.push(localToInstant(startDate, '00:00'));
  for (let i = 0; i < days; i++) {
    const d = addDays(startDate, i);
    if (weekdayOf(d) !== PURCHASE.weekday || (i === 0 && initialStocking)) continue;
    out.push(localToInstant(d, PURCHASE.time));
  }
  return out;
}

type Item = { at: Instant; order: 0 | 1 | 2; fact?: ConsumptionFact; date?: LocalDate };

const endOfDay = (d: LocalDate): Instant => new Date(Date.parse(localToInstant(addDays(d, 1), '00:00')) - 1).toISOString();

export function runScenario(opts: RunOptions): RunResult {
  const { policy, profile, marks = idealUser } = opts;
  const seed = opts.seed ?? DEFAULT_SEED;
  const startDate = opts.startDate ?? PERIOD_START;
  const days = opts.days ?? PERIOD_DAYS;
  const facts = opts.facts ?? generateReality(profile, { seed, startDate, days });
  const schedule = opts.schedule ?? purchaseSchedule(startDate, days);
  const periodEnd = localToInstant(addDays(startDate, days), '00:00');

  const products: Product[] = profile.products.map((p) => {
    const r = createProduct(p.input);
    if (!r.ok) throw new Error(`createProduct отклонил ${p.input.id}: ${r.error.message}`);
    return r.value;
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  const real = new Map(products.map((p) => [p.id, 0]));
  const journal = new Map<string, StockEvent[]>(products.map((p) => [p.id, []]));

  const timeline: Item[] = [
    ...schedule.map((at): Item => ({ at, order: 0 })),
    ...facts.map((fact): Item => ({ at: fact.at, order: 1, fact })),
    ...Array.from({ length: days }, (_, i): Item => {
      const date = addDays(startDate, i);
      return { at: endOfDay(date), order: 2, date };
    }),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.order - b.order));

  const events: StockEvent[] = [];
  const purchases: PurchaseRecord[] = [];
  const unmet: UnmetEntry[] = [];
  const daily: DayRecord[] = [];
  const divergence: RunResult['divergence'] = [];
  const today = new Map<string, { demand: number; served: number; unmet: number }>();
  let seq = 0;
  let minRealStock = 0;

  const stock = (id: string): number => real.get(id) ?? 0;

  const write = (m: Mark): void => {
    const product = productById.get(m.productId);
    if (!product) throw new Error(`неизвестная позиция ${m.productId}`);
    seq += 1;
    const input: StockEventInput = {
      id: `sim-${String(seq).padStart(6, '0')}`,
      seq,
      kind: m.kind,
      ...(m.quantity !== undefined ? { quantity: m.quantity } : {}),
      ...(m.packs !== undefined ? { packs: m.packs } : {}),
      ...(m.unitsPerPack !== undefined ? { unitsPerPack: m.unitsPerPack } : {}),
      occurredAt: m.occurredAt,
      recordedAt: m.recordedAt,
      source: `sim:${marks.name}`,
    };
    const r = createStockEvent(product, input);
    if (!r.ok) throw new Error(`createStockEvent отклонил событие ${JSON.stringify(input)}: ${r.error.message}`);
    events.push(r.value);
    journal.get(m.productId)?.push(r.value);
  };

  const reality: RealityView = {
    stock,
    demand: (id, from, to) => facts.filter((f) => f.productId === id && f.at >= from && f.at < to).reduce((s, f) => s + f.quantity, 0),
  };

  for (const item of timeline) {
    if (item.order === 0) {
      const nextAt = schedule.find((s) => s > item.at) ?? periodEnd;
      const decisions = policy.decide({
        at: item.at,
        nextAt,
        products,
        known: (id) => systemBalanceAt(journal.get(id) ?? [], item.at),
        ...(policy.needsReality ? { reality } : {}),
      });
      for (const d of decisions) {
        if (d.packs === 0) continue;
        const product = productById.get(d.productId);
        if (!product) throw new Error(`политика вернула неизвестную позицию ${d.productId}`);
        if (Number.isInteger(d.packs) && d.packs > 0) real.set(d.productId, stock(d.productId) + d.packs * product.unitsPerPack);
        const e: RealEvent = { type: 'purchase', productId: d.productId, at: item.at, packs: d.packs, unitsPerPack: product.unitsPerPack, stockAfter: stock(d.productId) };
        for (const m of marks.marks(e)) write(m);
        purchases.push({ productId: d.productId, at: item.at, packs: d.packs });
      }
    } else if (item.order === 1 && item.fact) {
      const { productId, at, quantity } = item.fact;
      const before = stock(productId);
      const eaten = Math.min(before, quantity);
      real.set(productId, before - eaten);
      minRealStock = Math.min(minRealStock, stock(productId));
      const cur = today.get(productId) ?? { demand: 0, served: 0, unmet: 0 };
      today.set(productId, { demand: cur.demand + quantity, served: cur.served + eaten, unmet: cur.unmet + quantity - eaten });
      if (quantity > eaten) unmet.push({ productId, at, quantity: quantity - eaten });
      const e: RealEvent = { type: 'consumption', productId, at, demand: quantity, eaten, unmet: quantity - eaten, stockBefore: before, stockAfter: stock(productId) };
      for (const m of marks.marks(e)) write(m);
    } else if (item.date !== undefined) {
      const rec: Record<string, DayProduct> = {};
      for (const p of products) {
        const t = today.get(p.id) ?? { demand: 0, served: 0, unmet: 0 };
        const knownEnd = systemBalanceAt(journal.get(p.id) ?? [], item.at);
        rec[p.id] = { ...t, realEnd: stock(p.id), knownEnd };
        divergence.push({ date: item.date, productId: p.id, diff: knownEnd - stock(p.id) });
      }
      daily.push({ date: item.date, products: rec });
      today.clear();
    }
  }

  return {
    scenario: opts.scenario ?? 'идеальный пользователь',
    seed, startDate, days,
    policyLabel: policy.label,
    markModel: marks.name,
    productIds: products.map((p) => p.id),
    events, purchases, unmet, daily, divergence, minRealStock,
  };
}

export type RunReport = {
  scenario: string;
  seed: number;
  period: { startDate: LocalDate; days: number };
  profile: string;
  metricsStatus: string;
  reality: string;
  policy: string;
  g1: G1Result;
  maxDivergence: number;
  g2: { value: number | null; note: string };
  calibrationQuestionsPerWeek: { value: number | null; note: string };
  eventCounts: Record<string, number>;
};

/** К14: пометки заглушек — данные, а не комментарии. */
export function buildReport(run: RunResult): RunReport {
  const eventCounts: Record<string, number> = {};
  for (const e of run.events) eventCounts[e.kind] = (eventCounts[e.kind] ?? 0) + 1;
  return {
    scenario: run.scenario,
    seed: run.seed,
    period: { startDate: run.startDate, days: run.days },
    profile: 'временный (Q-19)',
    metricsStatus: 'предварительно (Q-19)',
    reality: 'без календаря гостей и отъездов (до B-05)',
    policy: run.policyLabel,
    g1: computeG1({ unmet: run.unmet, purchases: run.purchases, startDate: run.startDate, days: run.days }),
    maxDivergence: run.divergence.reduce((m, d) => Math.max(m, Math.abs(d.diff)), 0),
    g2: { value: null, note: 'нет списка покупок до B-11' },
    calibrationQuestionsPerWeek: { value: null, note: 'нет калибровки до B-13' },
    eventCounts,
  };
}
