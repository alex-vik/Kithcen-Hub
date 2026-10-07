// T-007 К8, Р5: модель отметок — что из реальных фактов попадает в журнал системы.
export type RealEvent =
  | { type: 'purchase'; productId: string; at: string; packs: number; unitsPerPack: number }
  | { type: 'consumption'; productId: string; at: string; demand: number; eaten: number; stockBefore: number; stockAfter: number };

export type Mark = {
  productId: string;
  kind: 'purchase' | 'portion' | 'depleted';
  quantity?: number;
  packs?: number;
  unitsPerPack?: number;
  occurredAt: string;
  recordedAt: string;
};

export type MarkModel = { name: string; marks(e: RealEvent): Mark[] };

/** Р5: отмечает каждый реальный факт сразу и точно; неудовлетворённый спрос событий не порождает. */
export const idealUser: MarkModel = {
  name: 'идеальный пользователь',
  marks(e) {
    if (e.type === 'purchase') {
      return [{ productId: e.productId, kind: 'purchase', packs: e.packs, unitsPerPack: e.unitsPerPack, occurredAt: e.at, recordedAt: e.at }];
    }
    const out: Mark[] = [];
    if (e.eaten > 0) out.push({ productId: e.productId, kind: 'portion', quantity: e.eaten, occurredAt: e.at, recordedAt: e.at });
    if (e.eaten > 0 && e.stockAfter === 0) {
      out.push({ productId: e.productId, kind: 'depleted', occurredAt: e.at, recordedAt: e.at });
    }
    return out;
  },
};
