// B-00a, ADR-001/ADR-002/ADR-005: smoke-тест окружения. Прикладной логики не проверяет —
// только что раннер работает и платформа даёт то, на что опираются ADR.
import { describe, expect, it } from 'vitest';

describe('smoke: окружение', () => {
  it('раннер запускается', () => {
    expect(1 + 1).toBe(2);
  });

  it('тесты идут в UTC (NFR-14), а не в поясе машины', () => {
    expect(new Date(0).getTimezoneOffset()).toBe(0);
  });

  it('встроенный node:sqlite доступен (ADR-002)', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    const row = db.prepare('SELECT 1 AS one').get();
    db.close();
    expect({ ...row }).toEqual({ one: 1 });
  });

  it('Intl знает Europe/Vilnius с переходом на летнее время (BR-27, ADR-005)', () => {
    const offset = (iso: string): string | undefined =>
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Vilnius', timeZoneName: 'shortOffset' })
        .formatToParts(new Date(iso))
        .find((p) => p.type === 'timeZoneName')?.value;
    expect(offset('2026-01-15T12:00:00Z')).toBe('GMT+2');
    expect(offset('2026-07-15T12:00:00Z')).toBe('GMT+3');
  });
});
