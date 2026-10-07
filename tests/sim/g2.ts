// T-007 К13, Q-32: G-2 — доля позиций недельного списка, исправленных вручную.
// Исправлена: вычеркнута, добавлена или изменено количество. Знаменатель — итоговый список (вычеркнутая остаётся).
import { G2_TRAINING_WEEKS, OVERSHOOT_RESERVE_DAYS } from './run-config.ts';

export type ListItem = { productId: string; packs: number };
/** Реальность до следующей закупки: сколько единиц нужно докупить сверх реального остатка. */
export type Need = { productId: string; unitsNeeded: number; unitsPerPack: number; dailyUnits: number };
export type FinalStatus = 'untouched' | 'struck' | 'changed' | 'added';
export type FinalItem = { productId: string; packs: number; status: FinalStatus };
export type G2Week = { corrected: number; total: number };

/** Правило симулируемого пользователя: видит реальность и правит список. */
export function correctList(list: readonly ListItem[], needs: readonly Need[]): FinalItem[] {
  const out: FinalItem[] = [];
  const needOf = new Map(needs.map((n) => [n.productId, n]));
  for (const item of list) {
    const n = needOf.get(item.productId);
    const needPacks = n ? Math.max(0, Math.ceil(n.unitsNeeded / n.unitsPerPack)) : 0;
    if (!n || needPacks === 0) {
      out.push({ productId: item.productId, packs: 0, status: 'struck' });
      continue;
    }
    const bought = item.packs * n.unitsPerPack;
    const short = bought < n.unitsNeeded;
    const excess = bought - n.unitsNeeded > OVERSHOOT_RESERVE_DAYS * n.dailyUnits + n.unitsPerPack;
    out.push(
      short || excess
        ? { productId: item.productId, packs: needPacks, status: 'changed' }
        : { productId: item.productId, packs: item.packs, status: 'untouched' },
    );
  }
  const inList = new Set(list.map((i) => i.productId));
  for (const n of needs) {
    const needPacks = Math.ceil(n.unitsNeeded / n.unitsPerPack);
    if (!inList.has(n.productId) && needPacks > 0) out.push({ productId: n.productId, packs: needPacks, status: 'added' });
  }
  return out;
}

export function g2Week(final: readonly FinalItem[]): G2Week & { share: number | null } {
  const corrected = final.filter((f) => f.status !== 'untouched').length;
  return { corrected, total: final.length, share: final.length === 0 ? null : corrected / final.length };
}

/** За период: недели обучающего периода не входят ни в числитель, ни в знаменатель. */
export function g2Period(weeks: readonly G2Week[], trainingWeeks: number = G2_TRAINING_WEEKS): number | null {
  const used = weeks.slice(trainingWeeks);
  const total = used.reduce((s, w) => s + w.total, 0);
  return total === 0 ? null : used.reduce((s, w) => s + w.corrected, 0) / total;
}
