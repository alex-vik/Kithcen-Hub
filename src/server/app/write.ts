// T-005: сценарии записи событий остатка (BR-26, BR-02, NFR-08, NFR-14, ADR-003 §5.3, §6, §8, ADR-005).
import type { Result } from '../../domain/catalog.ts';
import { createStockEvent, resolveEventWrite, resolveSystemWrite } from '../../domain/journal.ts';
import type { StockEvent, StockEventInput, StockEventKind } from '../../domain/journal.ts';
import type { Instant } from '../../domain/time.ts';
import type { Clock } from '../clock.ts';
import type { Storage } from '../storage/index.ts';
import { derivedId } from './ids.ts';
import { normalizeClientTime } from './time.ts';

type Body = {
  productId: string;
  kind: StockEventKind;
  source: string;
  quantity?: number;
  value?: number;
  packs?: number;
  unitsPerPack?: number;
  targetId?: string;
};
export type ClientEventInput = Body & { id: string; occurredAt: unknown };
export type SystemItem = Body & { key: string; occurredAt: Instant };

export type ClientOutcome =
  | { outcome: 'new' | 'repeat'; event: StockEvent }
  | { outcome: 'conflict'; id: string; event: StockEvent }
  | { outcome: 'rejected'; attribute: string };
export type BatchOutcome =
  | { outcome: 'ok'; items: { outcome: 'new' | 'done'; event: StockEvent }[] }
  | { outcome: 'rejected'; index: number; attribute: string };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const REASON_ATTRIBUTE = { unknown_product: 'productId', invalid_time: 'occurredAt', invalid_target: 'targetId' } as const;

class Rejected extends Error {
  readonly attribute: string;
  constructor(attribute: string) {
    super(attribute);
    this.attribute = attribute;
  }
}

export function createWriteScenarios(deps: { storage: Storage; clock: Clock }) {
  const { storage, clock } = deps;

  /** Событие из тела; seq — заглушка, настоящий назначает хранилище. */
  function build(id: string, occurredAt: Instant, b: Body): Result<StockEvent> | { ok: false; error: { attribute: string } } {
    const product = storage.getProduct(b.productId);
    if (!product) return { ok: false, error: { attribute: 'productId' } };
    const input: StockEventInput = {
      id, seq: 0, kind: b.kind, occurredAt, recordedAt: clock.now(), source: b.source,
      ...(b.quantity !== undefined && { quantity: b.quantity }),
      ...(b.value !== undefined && { value: b.value }),
      ...(b.packs !== undefined && { packs: b.packs }),
      ...(b.unitsPerPack !== undefined && { unitsPerPack: b.unitsPerPack }),
      ...(b.targetId !== undefined && { targetId: b.targetId }),
    };
    return createStockEvent(product, input);
  }

  /** Запись по исходу домена; отказ хранилища — Rejected. */
  function store(e: StockEvent, resolve: typeof resolveEventWrite): ReturnType<typeof resolveEventWrite> {
    const r = resolve(storage.getStockEvent(e.id), e);
    if (r.outcome !== 'new') return r;
    const w = storage.addStockEvent(e);
    if (w.status === 'rejected') throw new Rejected(REASON_ATTRIBUTE[w.reason]);
    return { outcome: w.status === 'added' ? 'new' : 'repeat', event: w.event };
  }

  return {
    recordEvent(input: ClientEventInput): ClientOutcome {
      if (typeof input.id !== 'string' || !UUID_V4.test(input.id)) return { outcome: 'rejected', attribute: 'id' };
      const time = normalizeClientTime(input.occurredAt);
      if (!time.ok) return { outcome: 'rejected', attribute: 'occurredAt' };
      try {
        return storage.transaction((): ClientOutcome => {
          const e = build(input.id, time.value, input);
          if (!e.ok) return { outcome: 'rejected', attribute: e.error.attribute };
          const r = store(e.value, resolveEventWrite);
          if (r.outcome === 'conflict') return r;
          return { outcome: r.outcome === 'new' ? 'new' : 'repeat', event: r.event };
        });
      } catch (err) {
        if (err instanceof Rejected) return { outcome: 'rejected', attribute: err.attribute };
        throw err;
      }
    },

    recordSystemBatch(items: SystemItem[]): BatchOutcome {
      let index = 0;
      try {
        return storage.transaction((): BatchOutcome => {
          const out: { outcome: 'new' | 'done'; event: StockEvent }[] = [];
          for (index = 0; index < items.length; index++) {
            const item = items[index] as SystemItem;
            const e = build(derivedId(item.key), item.occurredAt, item);
            if (!e.ok) throw new Rejected(e.error.attribute);
            const r = store(e.value, resolveSystemWrite);
            out.push({ outcome: r.outcome === 'new' ? 'new' : 'done', event: r.event });
          }
          return { outcome: 'ok', items: out };
        });
      } catch (err) {
        if (err instanceof Rejected) return { outcome: 'rejected', index, attribute: err.attribute };
        throw err;
      }
    },
  };
}
