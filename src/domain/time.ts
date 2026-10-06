// ADR-005, BR-27, NFR-14. Только типы — функции времени пишутся по задачам шага 1/3.

/** Момент времени в UTC, ISO-8601 с суффиксом Z: `2026-10-06T21:00:00.000Z`. */
export type Instant = string;

/** Календарная дата в поясе дома (Europe/Vilnius): `2026-10-06`. Единица «суток» для автосписания. */
export type LocalDate = string;

/** IANA-идентификатор пояса; значение — из конфигурации, по умолчанию `Europe/Vilnius`. */
export type TimeZone = string;
