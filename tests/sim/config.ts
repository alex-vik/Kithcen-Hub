// T-006: параметры стенда симулятора. Это настройки теста, не поведения продукта (раздел 15 спеки не затрагивается).
import type { LocalDate } from '../../src/domain/time.ts';

export const TIME_ZONE = 'Europe/Vilnius';
/** T-006: сид по умолчанию. */
export const DEFAULT_SEED = 20261006;
/** T-006: начало периода (суббота) и длина; внутри оба перехода DST 2026. */
export const PERIOD_START: LocalDate = '2026-01-03';
export const PERIOD_DAYS = 365;
/** T-006: коэффициент вариации суточного расхода ритмичной позиции. */
export const RHYTHMIC_CV = 0.15;
/** Коэффициент вариации размера одного использования (рывковые, медленные). */
export const USE_SIZE_CV = 0.2;
/** Медленная позиция: на сколько использований делится одна упаковка за срок жизни. */
export const SLOW_USES_PER_PACK = 8;
/** Медленная позиция: разброс интервала между использованиями (доля от среднего). */
export const SLOW_GAP_JITTER = 0.3;
/** T-006: минимум позиций каждого типа во временном профиле. */
export const MIN_PER_TYPE = 3;
export const PROFILE_SIZE = { min: 20, max: 30 } as const;
/** T-006 К6: допуски. */
export const TOLERANCE = { rhythmic: 0.1, burst: 0.25, slow: 0.25 } as const;
