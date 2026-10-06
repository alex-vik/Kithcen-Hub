// T-001 (B-01): позиция каталога — атрибуты, единицы, пересчёт упаковок, норма, порция.
// FR-CAT-01, FR-CAT-02, FR-CAT-08, BR-03, BR-04, BR-05, BR-10; решения Q-28, Q-29, Q-30.
// ADR-004: чистые функции, отказ команды — CommandResult. Каркас: только типы и сигнатуры,
// логику пишет backend-dev. Идентификатор позиции и время создания — B-01b (хранение),
// активность как команда и product_log — B-12.

import type { Milli } from './quantity.ts';
import type { CommandResult } from './result.ts';

/** Расходная единица — закрытый набор (решение delivery-lead к T-001). */
export type ConsumptionUnit = 'г' | 'мл' | 'шт';

/** Тип списания: ритмичный, рывковый, медленный (спека 1.4). */
export type WriteOffType = 'rhythmic' | 'sporadic' | 'slow';

/** Период, за который пользователь задаёт норму (Q-29): сутки, неделя, N дней (N — целое > 0). */
export type NormPeriod =
  | { readonly kind: 'day' }
  | { readonly kind: 'week' }
  | { readonly kind: 'days'; readonly days: number };

/** Торговая упаковка и коэффициент — всегда парой (T-001 К6). */
export type Pack = {
  readonly name: string;
  /** Сколько тысячных долей расходной единицы в одной упаковке, > 0. */
  readonly sizeMilli: Milli;
};

/** Норма: суточная — для расчётов; введённая (количество + период) — только для показа. */
export type Norm = {
  /** Расходные единицы в сутки, тысячные доли, > 0 (T-001 К13). */
  readonly dailyMilli: Milli;
  /** Количество за период ровно в том виде, как задал пользователь, тысячные доли. */
  readonly enteredMilli: Milli;
  readonly period: NormPeriod;
};

/** Позиция каталога. Пустой атрибут — null. */
export type Product = {
  readonly name: string;
  readonly category: string | null;
  readonly writeOffType: WriteOffType | null;
  readonly unit: ConsumptionUnit;
  readonly pack: Pack | null;
  /** BR-10: заполняется только из ввода пользователя. */
  readonly norm: Norm | null;
  /** Нижний порог, ≥ 0. */
  readonly lowThresholdMilli: Milli | null;
  /** Ручная порция, > 0. null — не задана; эффективную даёт effectivePortion. */
  readonly portionMilli: Milli | null;
  readonly active: boolean;
};

/**
 * Ввод команды создания. Количества — в расходной единице, как ввёл пользователь
 * (250 — это 250 г, 0.003 — это 0,003 г); в тысячные доли их переводит команда.
 * Поля без значения можно не передавать или передать null.
 * unit — string, потому что недопустимая единица — отказ команды, а не ошибка типов (К4, К5).
 */
export type ProductInput = {
  readonly name: string;
  readonly unit?: string | null;
  readonly category?: string | null;
  readonly writeOffType?: WriteOffType | null;
  readonly packName?: string | null;
  /** Коэффициент: расходных единиц в упаковке. */
  readonly packSize?: number | null;
  /** Количество нормы за период normPeriod. */
  readonly normAmount?: number | null;
  readonly normPeriod?: NormPeriod | null;
  readonly lowThreshold?: number | null;
  readonly portion?: number | null;
};

/**
 * Ввод команды правки (FR-CAT-02). Непереданное поле (или undefined) — не меняется,
 * null — сбрасывается. Поля в тех же единицах, что в ProductInput.
 * Активности здесь нет: её меняет отдельная команда B-12 (К29).
 */
export type ProductPatch = Partial<ProductInput>;

/** Код отказа — поле, которое не прошло проверку. */
export type ProductError =
  | 'name' //          пусто или одни пробелы (К5)
  | 'unit' //          нет или не из набора ConsumptionUnit (К4, К5)
  | 'pack' //          упаковка без коэффициента или коэффициент без упаковки (К6)
  | 'pack_size' //     коэффициент ≤ 0 (К7)
  | 'norm' //          норма ≤ 0 или суточная округлилась до 0 (К7, К13)
  | 'norm_period' //   нет периода при норме, период без нормы, N не целое > 0 (К12)
  | 'low_threshold' // нижний порог < 0 (К7)
  | 'portion'; //      порция ≤ 0 (К7)

/** Код отказа пересчёта упаковок: у позиции нет упаковки (К18). */
export type PackError = 'no_pack';

/**
 * Команда создания позиции. Успех — активная позиция; норму сама не выставляет (BR-10).
 * T-001 К1–К14.
 */
export function createProduct(input: ProductInput): CommandResult<Product, ProductError> {
  throw new Error('not implemented: T-001');
}

/**
 * Команда ручной правки. Результат проверяется по тем же правилам и с теми же кодами,
 * что при создании; при отказе исходная позиция не меняется. T-001 К21, К22, К24–К29.
 */
export function editProduct(
  product: Product,
  patch: ProductPatch,
): CommandResult<Product, ProductError> {
  throw new Error('not implemented: T-001');
}

/**
 * Пересчёт числа упаковок позиции в тысячные доли расходной единицы
 * через её коэффициент (BR-03, BR-04). T-001 К15–К18.
 */
export function convertPacks(product: Product, packs: number): CommandResult<Milli, PackError> {
  throw new Error('not implemented: T-001');
}

/**
 * Суточная норма из введённой за период (Q-29): enteredMilli / дней периода,
 * одно округление к ближайшему, половина — от нуля. Период должен быть допустимым
 * (проверяют команды). T-001 К8–К11.
 */
export function dailyNormMilli(enteredMilli: Milli, period: NormPeriod): Milli {
  throw new Error('not implemented: T-001');
}

/**
 * Эффективная порция (FR-CAT-08, Q-30): ручная, если задана; иначе — из суточной нормы
 * (для «шт» — до целого, половина от нуля, не меньше 1 шт); без нормы и ручной порции — null.
 * T-001 К19–К24.
 */
export function effectivePortion(product: Product): Milli | null {
  throw new Error('not implemented: T-001');
}
