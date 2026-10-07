// T-005 К26: производный id = UUIDv5(NS, ключ) (BR-26, ADR-003 §8).
import { describe, expect, it } from 'vitest';
import { NS, derivedId, uuidV5 } from '../../../src/server/app/ids.ts';
import { NS_LITERAL, refV5 } from './helpers.ts';

const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('T-005 К26: UUIDv5', () => {
  it('T-005 К26: контрольный пример Python uuid — DNS + python.org', () => {
    expect(uuidV5(DNS, 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it('T-005 К26: формат — нижний регистр, версия 5, вариант RFC 4122; детерминизм и различимость', () => {
    const id = derivedId('auto_writeoff:p-2:2026-10-13');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(derivedId('auto_writeoff:p-2:2026-10-13')).toBe(id);
    expect(derivedId('auto_writeoff:p-2:2026-10-14')).not.toBe(id);
    expect(id).toBe(refV5(NS_LITERAL, 'auto_writeoff:p-2:2026-10-13'));
  });

  it('T-005 К26 golden: NS зафиксирован, id для ключа auto_writeoff:p-1:2026-10-12 — литерал', () => {
    expect(NS).toBe('3f6c2a9e-8b1d-4e57-a0c4-7d92e15b6f08');
    expect(derivedId('auto_writeoff:p-1:2026-10-12')).toBe('35954073-6b0f-5f70-bb81-fecef4823a17');
  });
});
