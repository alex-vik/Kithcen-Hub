// Публичный вход чистого домена (ADR-004, NFR-16).
// Без БД, сети, системных часов и случайности: время и параметры — аргументами.
// T-001, T-003: каталог — проверка ввода (FR-CAT-01, FR-CAT-07, BR-03).

import type { Params } from './params.ts';

export type { Params } from './params.ts';
export { defaultParams } from './params.ts';

type Instant = Temporal.Instant;

export type Product = {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  minimum: number | null;
  active: boolean;
};

export type ValidationResult = { ok: true } | { ok: false; errors: { field: string }[] };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// Проверки по полям; null — «пусто», undefined — «не менять» (пропуск).
const optional: Record<string, (v: unknown, p: Params) => boolean> = {
  category: (v, p) => typeof v === 'string' && p.productCategories.includes(v),
  minimum: (v) => isNum(v) && v >= 0,
};

// T-003 К3: единица необязательна при создании (по умолчанию первая из countUnits), в правке не очищается (Р-5).
function check(input: Record<string, unknown>, params: Params, required: boolean): ValidationResult {
  const errors: { field: string }[] = [];
  const name = input.name;
  if (name !== undefined || required) {
    if (typeof name !== 'string' || name.trim() === '') errors.push({ field: 'name' });
  }
  const unit = input.unit;
  if (unit !== undefined && (typeof unit !== 'string' || !params.countUnits.includes(unit))) errors.push({ field: 'unit' });
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

// Редактируемые атрибуты карточки (FR-CAT-01). Активность и id сюда не входят.
export const productFields = ['name', 'category', 'unit', 'minimum'] as const;
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

// T-003 К3, Р-5: атрибуты строки новой позиции; не заданная единица — первая из countUnits.
export function newProductRow(
  input: Record<string, unknown>,
  params: Params,
): { name: string; category: string | null; unit: string; minimum: number | null } {
  return {
    name: input.name as string,
    category: (input.category as string | null | undefined) ?? null,
    unit: (input.unit as string | undefined) ?? params.countUnits[0]!,
    minimum: (input.minimum as number | null | undefined) ?? null,
  };
}

// T-002, T-003: журнал остатка (BR-01, BR-03, BR-15; ADR-003 раздел 1).
export const stockEventTypes = ['purchase', 'used', 'ran_out', 'recount', 'cancel'] as const;
export type StockEventType = (typeof stockEventTypes)[number];

export type StockFoldEvent = { id: string; type: StockEventType; qty: number | null; occurredAt: number; seq: number; targetId?: string | null };
export type StockStep = { eventId: string; before: number; after: number };

// BR-01: остаток — свёртка событий по (occurredAt, seq). «Пересчитал» и «закончилось» задают остаток, покупка прибавляет, «использовал» вычитает.
// Минус допустим (BR-15): проверок остатка нет.
// T-004, BR-02, ADR-003 раздел 2: действующая отмена аннулирует цель; аннулированное и сами отмены в шаги не попадают.
// Цель всегда записана раньше отмены (меньший seq), поэтому идём от новых к старым.
export function foldStock(events: readonly StockFoldEvent[]): { balance: number; steps: StockStep[] } {
  const annulled = new Set<string>();
  for (const e of [...events].sort((a, b) => b.seq - a.seq)) {
    if (e.type === 'cancel' && !annulled.has(e.id) && e.targetId) annulled.add(e.targetId);
  }
  const sorted = events.filter((e) => e.type !== 'cancel' && !annulled.has(e.id)).sort((a, b) => a.occurredAt - b.occurredAt || a.seq - b.seq);
  let balance = 0;
  const steps = sorted.map((e) => {
    const before = balance;
    if (e.type === 'recount') balance = e.qty ?? 0;
    else if (e.type === 'ran_out') balance = 0;
    else if (e.type === 'purchase') balance += e.qty ?? 0;
    else balance -= e.qty ?? 0;
    return { eventId: e.id, before, after: balance };
  });
  return { balance, steps };
}

// T-003 К9: проверка ввода события, не остатка. Лишние поля игнорируются.
export function validateStockEventInput(input: Record<string, unknown>): ValidationResult {
  const errors: { field: string }[] = [];
  const { type, qty } = input;
  if (type === 'cancel' && (typeof input.targetId !== 'string' || input.targetId === '')) errors.push({ field: 'targetId' });
  if (typeof input.id !== 'string' || input.id === '') errors.push({ field: 'id' });
  if (typeof type !== 'string' || !(stockEventTypes as readonly string[]).includes(type)) {
    errors.push({ field: 'type' });
  } else if (type === 'recount') {
    if (!isNum(qty) || qty < 0) errors.push({ field: 'qty' });
  } else if (type === 'purchase') {
    if (!isNum(qty) || qty <= 0) errors.push({ field: 'qty' });
  } else if (type === 'used' && qty !== undefined && (!isNum(qty) || qty <= 0)) {
    errors.push({ field: 'qty' });
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// T-003 К6, К7 (5.2); T-004 Р-1, Р-2: значения колонок из проверенного ввода.
// «Закончилось» и отмена qty не хранят; «использовал» без qty — 1; у отмены время клиента игнорируется (берётся now), targetId только у отмены.
export function stockEventValues(input: Record<string, unknown>): { qty: number | null; occurredAt: Instant | undefined; targetId: string | null } {
  if (input.type === 'cancel') return { qty: null, occurredAt: undefined, targetId: input.targetId as string };
  const qty = input.type === 'ran_out' ? null : ((input.qty as number | undefined) ?? 1);
  return { qty, occurredAt: input.occurredAt as Instant | undefined, targetId: null };
}
