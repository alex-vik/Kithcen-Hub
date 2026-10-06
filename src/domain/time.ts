// ADR-005, BR-27, NFR-14. Типы времени и проверка isInstant (T-002 К18); остальные функции времени — по задачам шага 1/3.

/** Момент времени в UTC, ISO-8601 с суффиксом Z: `2026-10-06T21:00:00.000Z`. */
export type Instant = string;

/** Календарная дата в поясе дома (Europe/Vilnius): `2026-10-06`. Единица «суток» для автосписания. */
export type LocalDate = string;

/** IANA-идентификатор пояса; значение — из конфигурации, по умолчанию `Europe/Vilnius`. */
export type TimeZone = string;

const CANONICAL_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

/** T-002 К18, NFR-14: только `YYYY-MM-DDTHH:mm:ss.sssZ` с реально существующей датой и временем (UTC). */
export function isInstant(v: unknown): v is Instant {
  if (typeof v !== 'string') return false;
  const m = CANONICAL_INSTANT.exec(v);
  if (!m) return false;
  const [y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0, ms = 0] = m.slice(1).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms));
  return (
    t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d &&
    t.getUTCHours() === h && t.getUTCMinutes() === mi && t.getUTCSeconds() === s
  );
}
