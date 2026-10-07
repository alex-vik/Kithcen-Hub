// T-007: ручные профили и факты для проверок эталонов.
import type { ConsumptionFact } from './reality.ts';
import type { SimProduct, Usage } from './profile.ts';
import { addDays, localToInstant } from './local-time.ts';
import type { LocalDate } from '../../src/domain/time.ts';

export const manualProduct = (id: string, unitsPerPack: number, usage: Usage, unit: 'г' | 'шт' = 'г'): SimProduct => ({
  input: { id, name: id, unit, packName: 'уп', unitsPerPack, writeOffType: usage.kind },
  usage,
  consumers: ['people'],
});

export const usedOn = (productId: string, start: LocalDate, day: number, time: string, quantity: number): ConsumptionFact => ({
  productId,
  at: localToInstant(addDays(start, day), time),
  quantity,
});
