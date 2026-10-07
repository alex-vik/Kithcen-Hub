// T-007 К11, Р4: политики закупки до B-11. Интерфейс один: день и знания системы; оракул дополнительно получает реальность.
import type { Product } from '../../src/domain/catalog.ts';
import type { Instant } from '../../src/domain/time.ts';

export type RealityView = {
  /** Реальный остаток сейчас. */
  stock(productId: string): number;
  /** Реальный расход в [from, to). */
  demand(productId: string, from: Instant, to: Instant): number;
};

export type PolicyContext = {
  at: Instant;
  /** Следующая закупка (или конец периода): горизонт этой закупки. */
  nextAt: Instant;
  products: readonly Product[];
  /** Остаток по знаниям системы (срез К9). */
  known(productId: string): number;
  /** Только у политик с needsReality. */
  reality?: RealityView;
};

export type Purchase = { productId: string; packs: number };

export type PurchasePolicy = {
  label: string;
  needsReality?: boolean;
  decide(ctx: PolicyContext): Purchase[];
};

export const oraclePolicy: PurchasePolicy = {
  label: 'оракул (заглушка до B-11)',
  needsReality: true,
  decide(ctx) {
    const r = ctx.reality;
    if (!r) throw new Error('оракулу нужна реальность');
    return ctx.products.map((p) => {
      const need = r.demand(p.id, ctx.at, ctx.nextAt) - r.stock(p.id);
      return { productId: p.id, packs: Math.max(0, Math.ceil(need / p.unitsPerPack)) };
    });
  },
};

export const neverBuysPolicy: PurchasePolicy = { label: 'не покупает', decide: () => [] };
