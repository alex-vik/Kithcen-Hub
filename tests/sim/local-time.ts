// T-006 К4, BR-27, NFR-14: местные сутки Europe/Vilnius <-> Instant (UTC). Правило ЕС: летнее время
// с последнего воскресенья марта 01:00 UTC до последнего воскресенья октября 01:00 UTC.
// Временный помощник симулятора; когда B-06 даст доменную функцию, симулятор перейдёт на неё (B-05).
import type { Instant, LocalDate } from '../../src/domain/time.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function lastSundayUtc(year: number, monthIndex: number): number {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  return Date.UTC(year, monthIndex, lastDay.getUTCDate() - lastDay.getUTCDay(), 1);
}

function isDstAtUtc(ms: number): boolean {
  const year = new Date(ms).getUTCFullYear();
  return ms >= lastSundayUtc(year, 2) && ms < lastSundayUtc(year, 9);
}

/** Смещение Vilnius от UTC в часах в данный момент. */
const offsetHoursAt = (ms: number): number => (isDstAtUtc(ms) ? 3 : 2);

const parseDate = (d: LocalDate): number => {
  const [y = 0, m = 1, day = 1] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
};

const fmtDate = (ms: number): LocalDate => new Date(ms).toISOString().slice(0, 10);

/**
 * Местная дата + 'HH:mm' (или 'HH:mm:ss') -> Instant. По ADR-005: двусмысленное осеннее время — первое вхождение;
 * время из весеннего разрыва (03:00–03:59) — первый момент после разрыва (04:00 местного).
 */
export function localToInstant(date: LocalDate, time: string): Instant {
  const [h = 0, mi = 0, s = 0] = time.split(':').map(Number);
  const wall = parseDate(date) + h * HOUR + mi * 60_000 + s * 1000;
  const asDst = wall - 3 * HOUR;
  if (isDstAtUtc(asDst)) return new Date(asDst).toISOString();
  const asStd = wall - 2 * HOUR;
  // зимнее прочтение попало в летнее время — такого местного времени нет (разрыв)
  const utc = isDstAtUtc(asStd) ? lastSundayUtc(new Date(asStd).getUTCFullYear(), 2) : asStd;
  return new Date(utc).toISOString();
}

/** Местная дата момента. */
export function localDateOf(instant: Instant): LocalDate {
  const ms = Date.parse(instant);
  return fmtDate(ms + offsetHoursAt(ms) * HOUR);
}

export function addDays(date: LocalDate, n: number): LocalDate {
  return fmtDate(parseDate(date) + n * DAY);
}

export function localDates(start: LocalDate, days: number): LocalDate[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}
