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

// T-002: журнал остатка (BR-01, BR-03, BR-15; ADR-003 раздел 1).
export const stockEventTypes = [
  'purchase', 'portion', 'auto_writeoff', 'recipe_writeoff', 'spoilage', 'ran_out', 'inventory',
] as const;
export type StockEventType = (typeof stockEventTypes)[number];

export type StockFoldEvent = { id: string; type: StockEventType; qty: number | null; occurredAt: number; seq: number };
export type StockStep = { eventId: string; before: number; after: number };

// BR-01: остаток — свёртка событий по (occurredAt, seq). Значения задают остаток, приход прибавляет, остальное вычитает.
// Минус допустим (BR-15): проверок остатка нет.
export function foldStock(events: readonly StockFoldEvent[]): { balance: number; steps: StockStep[] } {
  const sorted = [...events].sort((a, b) => a.occurredAt - b.occurredAt || a.seq - b.seq);
  let balance = 0;
  const steps = sorted.map((e) => {
    const before = balance;
    if (e.type === 'inventory') balance = e.qty ?? 0;
    else if (e.type === 'ran_out') balance = 0;
    else if (e.type === 'purchase') balance += e.qty ?? 0;
    else balance -= e.qty ?? 0;
    return { eventId: e.id, before, after: balance };
  });
  return { balance, steps };
}

// T-002 К23: проверка ввода события, не остатка. Лишние поля игнорируются.
export function validateStockEventInput(input: Record<string, unknown>): ValidationResult {
  const errors: { field: string }[] = [];
  const type = input.type;
  if (typeof input.id !== 'string' || input.id === '') errors.push({ field: 'id' });
  if (typeof type !== 'string' || !(stockEventTypes as readonly string[]).includes(type)) {
    errors.push({ field: 'type' });
  } else {
    const { qty, packages, packageFactor } = input;
    const positive = (v: unknown) => isNum(v) && v > 0;
    if (type === 'purchase') {
      if (qty === undefined && packages === undefined) errors.push({ field: 'qty' }, { field: 'packages' });
      if (qty !== undefined && !positive(qty)) errors.push({ field: 'qty' });
      if (packages !== undefined && !positive(packages)) errors.push({ field: 'packages' });
      if (packageFactor !== undefined && packageFactor !== null && !positive(packageFactor)) {
        errors.push({ field: 'packageFactor' });
      }
    } else if (type === 'inventory') {
      if (!isNum(qty) || qty < 0) errors.push({ field: 'qty' });
    } else if (type !== 'ran_out' && !positive(qty)) {
      errors.push({ field: 'qty' });
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// T-002: значения для записи события из проверенного ввода. «Выкинул до нуля» qty не хранит;
// покупка в упаковках считает qty из упаковок: коэффициент из ввода, иначе позиции (Р-2, BR-04);
// нет коэффициента — отказ по packageFactor ([Q-28]).
export type StockEventValues =
  | { ok: true; qty: number | null; packages: number | null; packageFactor: number | null }
  | { ok: false; errors: { field: string }[] };

export function stockEventValues(input: Record<string, unknown>, productFactor: number | null): StockEventValues {
  if (input.type === 'ran_out') return { ok: true, qty: null, packages: null, packageFactor: null };
  if (input.type === 'purchase' && input.packages !== undefined) {
    const packages = input.packages as number;
    const packageFactor = (input.packageFactor as number | null | undefined) ?? productFactor;
    const qty = packagesToUnits(packages, packageFactor);
    return qty === null ? { ok: false, errors: [{ field: 'packageFactor' }] } : { ok: true, qty, packages, packageFactor };
  }
  return { ok: true, qty: (input.qty as number | undefined) ?? null, packages: null, packageFactor: null };
}

// T-002 К24: расходную единицу не меняют, пока у позиции есть события (BR-05, инвариант 3).
export function validateUnitChange(
  current: Pick<Product, 'consumptionUnit'>,
  patch: Record<string, unknown>,
  hasEvents: boolean,
): ValidationResult {
  const unit = patch.consumptionUnit;
  return hasEvents && unit !== undefined && unit !== current.consumptionUnit
    ? { ok: false, errors: [{ field: 'consumptionUnit' }] }
    : { ok: true };
}
