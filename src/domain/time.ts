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

// T-010, BR-27, NFR-14, ADR-005: сутки по поясу дома через Intl, без библиотек и без системных часов.

const formatters = new Map<TimeZone, Intl.DateTimeFormat>();

/** Местные «настенные» компоненты момента как UTC-миллисекунды (мс отбрасываются форматтером и восстанавливаются). */
function wallMs(ms: number, timeZone: TimeZone): number {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  const p: Record<string, number> = {};
  for (const { type, value } of f.formatToParts(new Date(ms))) p[type] = Number(value);
  const sub = ((ms % 1000) + 1000) % 1000;
  return Date.UTC(p['year'] ?? 0, (p['month'] ?? 1) - 1, p['day'] ?? 1, p['hour'] ?? 0, p['minute'] ?? 0, p['second'] ?? 0, sub);
}

const offsetAt = (ms: number, timeZone: TimeZone): number => wallMs(ms, timeZone) - ms;
const toInstant = (ms: number): Instant => new Date(ms).toISOString();
const dayMs = (day: LocalDate): number => Date.parse(`${day}T00:00:00.000Z`);

export function localDateOf(instant: Instant, timeZone: TimeZone): LocalDate {
  return toInstant(wallMs(Date.parse(instant), timeZone)).slice(0, 10);
}

export function addDays(day: LocalDate, n: number): LocalDate {
  return toInstant(dayMs(day) + n * 86_400_000).slice(0, 10);
}

/** Местное время суток D в UTC: из весеннего разрыва — первый момент после него, из осеннего повтора — первое вхождение. */
export function localTimeOn(day: LocalDate, hhmm: string, timeZone: TimeZone): Instant {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const wall = dayMs(day) + (h * 60 + m) * 60_000;
  const before = offsetAt(wall - 86_400_000, timeZone);
  const after = offsetAt(wall + 86_400_000, timeZone);
  const valid = [...new Set([before, after])].map((o) => wall - o).filter((t) => offsetAt(t, timeZone) === wall - t);
  if (valid.length > 0) return toInstant(Math.min(...valid));
  // разрыв: первый момент с новым смещением
  let lo = wall - Math.max(before, after);
  let hi = wall - Math.min(before, after);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetAt(mid, timeZone) === after) hi = mid;
    else lo = mid;
  }
  return toInstant(hi);
}

/** `[00:00 суток D, 00:00 суток D+1)` в UTC. */
export function dayBounds(day: LocalDate, timeZone: TimeZone): { start: Instant; end: Instant } {
  return { start: localTimeOn(day, '00:00', timeZone), end: localTimeOn(addDays(day, 1), '00:00', timeZone) };
}

/** FR-CON-07, FR-CON-08: все D > cursor, чьи сутки завершены к `now` (наступило время автосписания D+1), по возрастанию. */
export function pendingDays(
  cursor: LocalDate,
  now: Instant,
  params: { timeZone: TimeZone; autoWriteoffTime: string },
): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = addDays(cursor, 1); localTimeOn(addDays(d, 1), params.autoWriteoffTime, params.timeZone) <= now; d = addDays(d, 1)) {
    out.push(d);
  }
  return out;
}

/** T-012, FR-ABS-01: `YYYY-MM-DD` с существующей датой. */
export function isLocalDate(v: unknown): v is LocalDate {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y = 0, m = 0, d = 0] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
