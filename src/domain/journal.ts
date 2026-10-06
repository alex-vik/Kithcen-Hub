// T-002: журнал событий остатка и свёртка (BR-01, BR-03, BR-15, NFR-08, ADR-003 §4, §5.1).
// Чистые функции: без БД, часов и исключений на невалидном вводе (ADR-004).
import { packsToUnits } from './catalog.ts';
import type { Product, Result } from './catalog.ts';
import { isInstant } from './time.ts';
import type { Instant } from './time.ts';

export type IncrementKind = 'purchase' | 'portion' | 'auto_writeoff' | 'recipe' | 'spoilage';
export type ValueKind = 'inventory' | 'depleted';
export type StockEventKind = IncrementKind | ValueKind;

export type StockEvent = {
  readonly id: string;
  readonly seq: number;
  readonly productId: string;
  readonly kind: StockEventKind;
  /** Расходная единица, > 0; у приращений. */
  readonly quantity?: number;
  /** Расходная единица, >= 0; у inventory. */
  readonly value?: number;
  readonly packs?: number;
  readonly unitsPerPack?: number;
  readonly occurredAt: Instant;
  readonly recordedAt: Instant;
  readonly source: string;
};

export type StockEventInput = {
  id: string;
  seq: number;
  kind: StockEventKind;
  quantity?: number;
  value?: number;
  packs?: number;
  unitsPerPack?: number;
  occurredAt: Instant;
  recordedAt: Instant;
  source: string;
};

export type LedgerRow = {
  eventId: string;
  before: number;
  after: number;
  /** after − before у inventory/depleted; null у приращений. */
  implicit: number | null;
};

const fail = (attribute: string, message: string): Result<never> => ({
  ok: false,
  error: { attribute, code: 'invalid', message },
});

const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isNonEmpty = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

const SIGN: Record<IncrementKind, 1 | -1> = { purchase: 1, portion: -1, auto_writeoff: -1, recipe: -1, spoilage: -1 };
const isIncrement = (k: StockEventKind): k is IncrementKind => k in SIGN;

function incrementEvent(
  common: Omit<StockEvent, 'kind' | 'quantity'>,
  kind: IncrementKind,
  quantity: number | undefined,
): Result<StockEvent> {
  if (!isPositive(quantity)) return fail('quantity', 'количество должно быть конечным числом больше нуля');
  return { ok: true, value: { ...common, kind, quantity } };
}

export function createStockEvent(product: Product, input: StockEventInput): Result<StockEvent> {
  if (!isNonEmpty(input.id)) return fail('id', 'id не может быть пустым');
  if (!Number.isInteger(input.seq)) return fail('seq', 'seq должен быть целым числом');
  if (!isInstant(input.occurredAt)) return fail('occurredAt', 'время должно быть в формате YYYY-MM-DDTHH:mm:ss.sssZ');
  if (!isInstant(input.recordedAt)) return fail('recordedAt', 'время должно быть в формате YYYY-MM-DDTHH:mm:ss.sssZ');
  if (!isNonEmpty(input.source)) return fail('source', 'источник не может быть пустым');

  const common = {
    id: input.id,
    seq: input.seq,
    productId: product.id,
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt,
    source: input.source,
  };

  switch (input.kind) {
    case 'depleted':
      return { ok: true, value: { ...common, kind: 'depleted' } };
    case 'inventory':
      if (typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < 0) {
        return fail('value', 'значение должно быть конечным числом не меньше нуля');
      }
      return { ok: true, value: { ...common, kind: 'inventory', value: input.value } };
    case 'purchase':
      if (input.packs !== undefined) {
        if (!Number.isInteger(input.packs) || input.packs < 1) return fail('packs', 'число упаковок — целое от 1');
        if (input.unitsPerPack !== undefined && !isPositive(input.unitsPerPack)) {
          return fail('unitsPerPack', 'коэффициент должен быть конечным числом больше нуля');
        }
        const unitsPerPack = input.unitsPerPack ?? product.unitsPerPack;
        return {
          ok: true,
          value: {
            ...common,
            kind: 'purchase',
            quantity: packsToUnits(product, input.packs, unitsPerPack),
            packs: input.packs,
            unitsPerPack,
          },
        };
      }
      return incrementEvent(common, 'purchase', input.quantity);
    case 'portion':
    case 'auto_writeoff':
    case 'recipe':
    case 'spoilage':
      return incrementEvent(common, input.kind, input.quantity);
    default:
      return fail('kind', 'неизвестный тип события');
  }
}

function ordered(events: readonly StockEvent[]): StockEvent[] {
  return [...events].sort((a, b) =>
    a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : a.seq - b.seq,
  );
}

function apply(balance: number, e: StockEvent): number {
  if (e.kind === 'inventory') return e.value as number;
  if (e.kind === 'depleted') return 0;
  return balance + SIGN[e.kind] * (e.quantity as number);
}

/** BR-01: свёртка по (occurredAt, seq) от 0; asOf включительно; снизу не ограничивается (BR-15). */
export function stockBalance(events: readonly StockEvent[], asOf?: Instant): number {
  let balance = 0;
  for (const e of ordered(events)) {
    if (asOf !== undefined && e.occurredAt > asOf) break;
    balance = apply(balance, e);
  }
  return balance;
}

/** NFR-08: строка на каждое событие; implicit у значений-событий — after − before. */
export function stockLedger(events: readonly StockEvent[]): LedgerRow[] {
  let balance = 0;
  return ordered(events).map((e) => {
    const before = balance;
    balance = apply(before, e);
    return { eventId: e.id, before, after: balance, implicit: isIncrement(e.kind) ? null : balance - before };
  });
}
