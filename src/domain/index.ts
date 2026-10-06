// Публичный вход чистого домена (ADR-004, NFR-16).
// Без БД, сети, системных часов и случайности: время и параметры — аргументами.
// T-001: каталог — проверка ввода, пересчёт упаковок, предложенная порция (FR-CAT-01, FR-CAT-08, BR-03).

import type { Params } from './params.ts';

export type { Params } from './params.ts';
export { defaultParams } from './params.ts';

export const writeOffTypes = ['ритмичный', 'рывковый', 'медленный'] as const;

export type Product = {
  id: string;
  name: string;
  category: string | null;
  writeOffType: string | null;
  consumptionUnit: string;
  packageName: string | null;
  packageFactor: number | null;
  norm: number | null;
  lowStockThreshold: number | null;
  portion: number | null;
  active: boolean;
};

export type ValidationResult = { ok: true } | { ok: false; errors: { field: string }[] };

// BR-03: упаковки → расходные единицы. Без коэффициента пересчёта нет — null.
export function packagesToUnits(packages: number, factor: number | null): number | null {
  return factor === null ? null : packages * factor;
}

// FR-CAT-08: ручная порция в приоритете; иначе норма × доля; иначе пусто. В базу не пишется.
export function suggestPortion(
  product: { norm: number | null; portion: number | null },
  params: Params,
): number | null {
  if (product.portion !== null) return product.portion;
  if (product.norm !== null) return product.norm * params.suggestedPortionShare;
  return null;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// Проверки по полям; null — «пусто», undefined — «не менять» (пропуск).
const optional: Record<string, (v: unknown, p: Params) => boolean> = {
  category: (v, p) => typeof v === 'string' && p.productCategories.includes(v),
  writeOffType: (v) => typeof v === 'string' && (writeOffTypes as readonly string[]).includes(v),
  packageName: (v) => typeof v === 'string',
  packageFactor: (v) => isNum(v) && v > 0,
  portion: (v) => isNum(v) && v > 0,
  norm: (v) => isNum(v) && v >= 0,
  lowStockThreshold: (v) => isNum(v) && v >= 0,
};

function check(input: Record<string, unknown>, params: Params, required: boolean): ValidationResult {
  const errors: { field: string }[] = [];
  const name = input.name;
  if (name !== undefined || required) {
    if (typeof name !== 'string' || name.trim() === '') errors.push({ field: 'name' });
  }
  const unit = input.consumptionUnit;
  if (unit !== undefined || required) {
    if (typeof unit !== 'string' || !params.consumptionUnits.includes(unit)) errors.push({ field: 'consumptionUnit' });
  }
  for (const [field, valid] of Object.entries(optional)) {
    const v = input[field];
    if (v !== undefined && v !== null && !valid(v, params)) errors.push({ field });
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateNewProduct(input: Record<string, unknown>, params: Params): ValidationResult {
  return check(input, params, true);
}

export function validateProductPatch(patch: Record<string, unknown>, params: Params): ValidationResult {
  return check(patch, params, false);
}

// Редактируемые атрибуты карточки (FR-CAT-01, FR-CAT-08). Активность и id сюда не входят.
export const productFields = [
  'name', 'category', 'writeOffType', 'consumptionUnit', 'packageName',
  'packageFactor', 'norm', 'lowStockThreshold', 'portion',
] as const;
export type ProductField = (typeof productFields)[number];

export type ProductDiff = { before: Record<string, unknown>; after: Record<string, unknown> };

// T-001 К9, К5: различия правки. Пропущенные и совпадающие с текущими поля не учитываются;
// пустой after — «без изменений», запись не нужна.
export function diffProduct(current: Product, patch: Record<string, unknown>): ProductDiff {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const f of productFields) {
    const next = patch[f];
    if (next !== undefined && next !== current[f]) {
      before[f] = current[f];
      after[f] = next;
    }
  }
  return { before, after };
}

// T-001 К3, К16: значения для записи о создании — только заданные (не null) атрибуты.
export function newProductAttrs(input: Record<string, unknown>): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const f of productFields) {
    if (input[f] !== undefined && input[f] !== null) attrs[f] = input[f];
  }
  return attrs;
}
