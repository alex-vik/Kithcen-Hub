// T-009: кэш остатков в памяти со знаком seq (ADR-003a §4, §5; BR-01, BR-02, BR-15).
// Кэш — производное: позиция пересобирается целиком через stockBalance, приращений поверх кэша нет.
import { stockBalance } from '../../domain/journal.ts';
import type { Storage } from '../storage/index.ts';

export type BalanceCache = {
  balance(productId: string): number;
  all(): ReadonlyMap<string, number>;
  warm(): void;
};

export function createBalanceCache({ storage }: { storage: Storage }): BalanceCache {
  let cache = new Map<string, number>();
  let w: number | undefined; // знак: MAX(seq), на котором кэш актуален; undefined — кэш пуст
  const compute = (id: string): number => stockBalance(storage.listStockEvents(id));

  /** Вне транзакции приводит кэш к журналу (ADR-003a §4.1.4). */
  function refresh(): void {
    const m = storage.maxStockSeq(); // знак читается до пересборки
    if (w === undefined || m < w) {
      const next = new Map<string, number>();
      for (const p of storage.listProducts()) next.set(p.id, compute(p.id));
      cache = next;
    } else if (m > w) {
      for (const id of storage.productsChangedBetween(w, m)) cache.set(id, compute(id));
    }
    w = m; // только после пересборки всех позиций шага
  }

  function all(): ReadonlyMap<string, number> {
    const inTx = storage.inTransaction();
    if (!inTx) refresh();
    const out = new Map<string, number>();
    for (const { id } of storage.listProducts()) {
      let v = inTx ? undefined : cache.get(id);
      if (v === undefined) {
        v = compute(id);
        if (!inTx) cache.set(id, v);
      }
      out.set(id, v);
    }
    return out;
  }

  return {
    balance(productId) {
      if (storage.inTransaction()) return compute(productId);
      refresh();
      let v = cache.get(productId);
      if (v === undefined) {
        v = compute(productId);
        cache.set(productId, v);
      }
      return v;
    },
    all,
    warm() {
      if (!storage.inTransaction()) all();
    },
  };
}
