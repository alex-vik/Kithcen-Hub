// T-005 К19: время клиента приводится к канону YYYY-MM-DDTHH:mm:ss.sssZ (NFR-14, решение НВ-2).
import { describe, expect, it } from 'vitest';
import { normalizeClientTime } from '../../../src/server/app/time.ts';

describe('T-005 К19: приведение времени клиента к канону', () => {
  const ok: [string, string][] = [
    ['2026-10-12T12:00:00+03:00', '2026-10-12T09:00:00.000Z'],
    ['2026-10-12T00:30:00.000+03:00', '2026-10-11T21:30:00.000Z'],
    ['2026-10-12T09:00:00Z', '2026-10-12T09:00:00.000Z'],
    ['2026-10-12T09:00:00.5Z', '2026-10-12T09:00:00.500Z'],
    ['2026-10-12T09:00:00.000Z', '2026-10-12T09:00:00.000Z'],
  ];
  for (const [input, canon] of ok) {
    it(`T-005 К19: ${input} -> ${canon}`, () => {
      expect(normalizeClientTime(input)).toStrictEqual({ ok: true, value: canon });
    });
  }

  const bad: [string, unknown][] = [
    ['без смещения', '2026-10-12T09:00:00'],
    ['только дата', '2026-10-12'],
    ['несуществующая дата', '2026-02-30T10:00:00Z'],
    ['4 знака дроби', '2026-10-12T09:00:00.1234Z'],
    ['пробел вместо T', '2026-10-12 09:00:00Z'],
    ['слово', 'завтра'],
    ['пустая строка', ''],
    ['число', 1760259600000],
    ['без секунд', '2026-10-12T09:00Z'],
  ];
  for (const [name, input] of bad) {
    it(`T-005 К19: отказ с атрибутом occurredAt, без исключения — ${name}`, () => {
      const r = normalizeClientTime(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.attribute).toBe('occurredAt');
    });
  }
});
