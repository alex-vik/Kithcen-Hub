// T-005 К19, NFR-14, решение НВ-2: время клиента -> канон YYYY-MM-DDTHH:mm:ss.sssZ.
import type { Result } from '../../domain/catalog.ts';
import { isInstant } from '../../domain/time.ts';
import type { Instant } from '../../domain/time.ts';

const RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

const bad = (): Result<never> => ({
  ok: false,
  error: { attribute: 'occurredAt', code: 'invalid', message: 'время: ISO-8601 с секундами и смещением Z или ±HH:MM' },
});

export function normalizeClientTime(v: unknown): Result<Instant> {
  if (typeof v !== 'string') return bad();
  const m = RE.exec(v);
  if (!m) return bad();
  const [y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0] = m.slice(1, 7).map(Number);
  const ms = Number((m[7] ?? '').padEnd(3, '0'));
  const local = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms));
  // календарь и время должны существовать (отсекает 30 февраля, 24:00, 60 секунд)
  if (
    local.getUTCFullYear() !== y || local.getUTCMonth() !== mo - 1 || local.getUTCDate() !== d ||
    local.getUTCHours() !== h || local.getUTCMinutes() !== mi || local.getUTCSeconds() !== s
  ) return bad();
  let offsetMin = 0;
  if (m[8] !== undefined) {
    const oh = Number(m[9]);
    const om = Number(m[10]);
    if (oh > 23 || om > 59) return bad();
    offsetMin = (m[8] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  const t = new Date(local.getTime() - offsetMin * 60_000);
  if (Number.isNaN(t.getTime())) return bad();
  const value = t.toISOString();
  return isInstant(value) ? { ok: true, value } : bad();
}
