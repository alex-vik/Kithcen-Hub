// T-001: позиция каталога (FR-CAT-01, FR-CAT-02, FR-CAT-08, BR-03, BR-04, BR-05, BR-08, BR-10).
// Чистые функции: без БД, сети, часов и исключений на невалидном вводе (ADR-004).
import type { Instant } from './time.ts';

export type Unit = 'г' | 'мл' | 'шт';
export type WriteOffType = 'rhythmic' | 'burst' | 'slow' | 'unset';

const UNITS: readonly string[] = ['г', 'мл', 'шт'];
const WRITE_OFF_TYPES: readonly string[] = ['rhythmic', 'burst', 'slow', 'unset'];

export type Product = {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly writeOffType: WriteOffType;
  readonly unit: Unit;
  readonly packName: string;
  /** Расходных единиц в одной упаковке. */
  readonly unitsPerPack: number;
  /** Суточный расход в расходной единице; задаётся только пользователем (BR-10). */
  readonly norm: number | null;
  readonly lowThreshold: number | null;
  readonly portion: number | null;
};

export type ProductInput = {
  id: string;
  name: string;
  category?: string | null;
  writeOffType?: WriteOffType;
  unit: Unit;
  packName: string;
  unitsPerPack: number;
  norm?: number | null;
  lowThreshold?: number | null;
  portion?: number | null;
};

export type CatalogError = { attribute: string; code: string; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; error: CatalogError };

/** Форма события состояния (ADR-003 §7); запись событий — B-12. */
export type StateEvent = {
  id: string;
  seq: number;
  productId: string;
  occurredAt: Instant;
  /** T-004 К32: когда событие записано; на активность не влияет. */
  recordedAt: Instant;
  state: 'active' | 'inactive';
  reason: 'user_button' | 'auto_archive' | 'purchase' | 'user_restore';
  /** T-004 К32: ссылка на событие-повод (например, покупку); необязательна. */
  refEventId?: string;
};

/** Параметры раздела 15 спеки. */
export type CatalogParams = { portionsPerDailyNorm: number };

const fail = (attribute: string, code: string, message: string): Result<never> => ({
  ok: false,
  error: { attribute, code, message },
});

const isPositive = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isNonNegative = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isNonEmptyString = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

function validate(p: Product): Result<Product> {
  if (!isNonEmptyString(p.name)) return fail('name', 'invalid', 'название не может быть пустым');
  if (!UNITS.includes(p.unit)) return fail('unit', 'invalid', 'единица должна быть г, мл или шт');
  if (!WRITE_OFF_TYPES.includes(p.writeOffType)) return fail('writeOffType', 'invalid', 'неизвестный тип списания');
  if (!isNonEmptyString(p.packName)) return fail('packName', 'invalid', 'название упаковки не может быть пустым');
  if (!isPositive(p.unitsPerPack)) return fail('unitsPerPack', 'invalid', 'коэффициент должен быть конечным числом больше нуля');
  if (p.norm !== null && !isPositive(p.norm)) return fail('norm', 'invalid', 'норма должна быть больше нуля или пуста');
  if (p.lowThreshold !== null && !isNonNegative(p.lowThreshold)) {
    return fail('lowThreshold', 'invalid', 'нижний порог не может быть меньше нуля');
  }
  if (p.portion !== null && !isPositive(p.portion)) return fail('portion', 'invalid', 'порция должна быть больше нуля или пуста');
  return { ok: true, value: p };
}

export function createProduct(input: ProductInput): Result<Product> {
  return validate({
    id: input.id,
    name: input.name,
    category: input.category ?? null,
    writeOffType: input.writeOffType ?? 'unset',
    unit: input.unit,
    packName: input.packName,
    unitsPerPack: input.unitsPerPack,
    norm: input.norm ?? null,
    lowThreshold: input.lowThreshold ?? null,
    portion: input.portion ?? null,
  });
}

export type ProductPatch = Partial<Omit<Product, 'id' | 'unit'>>;

const EDITABLE = ['name', 'category', 'writeOffType', 'packName', 'unitsPerPack', 'norm', 'lowThreshold', 'portion'] as const;

/** Правка атрибутов, кроме id и расходной единицы (её — changeUnit). Остальные величины не пересчитываются. */
export function updateProduct(p: Product, patch: ProductPatch): Result<Product> {
  const next: Record<string, unknown> = { ...p };
  for (const key of EDITABLE) {
    if (key in patch) next[key] = patch[key];
  }
  return validate(next as Product);
}

/** BR-05: единица меняется, только пока по позиции нет событий остатка. */
export function changeUnit(p: Product, unit: Unit, hasStockEvents: boolean): Result<Product> {
  if (!UNITS.includes(unit)) return fail('unit', 'invalid', 'единица должна быть г, мл или шт');
  if (hasStockEvents) return fail('unit', 'has_history', 'у позиции есть история — создайте новую позицию');
  return { ok: true, value: { ...p, unit } };
}

/** FR-CAT-08: предложение порции из суточной нормы; в позицию не записывается. */
export function suggestPortion(p: Product, params: CatalogParams): number | null {
  if (p.norm === null) return null;
  return p.norm / params.portionsPerDailyNorm;
}

/** BR-03, BR-04: упаковки в расходные единицы; явный коэффициент — для упаковки другого размера. */
export function packsToUnits(p: Product, packs: number, unitsPerPack: number = p.unitsPerPack): number {
  return packs * unitsPerPack;
}

/** ADR-003 §7: решает последнее по (occurredAt, seq) событие; нет событий — активна. */
export function isActive(events: readonly StateEvent[]): boolean {
  let last: StateEvent | undefined;
  for (const e of events) {
    if (!last || e.occurredAt > last.occurredAt || (e.occurredAt === last.occurredAt && e.seq > last.seq)) last = e;
  }
  return last === undefined || last.state === 'active';
}
