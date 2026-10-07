// T-005 К29: реальные часы отдают канон (NFR-14). Единственный тест с системным временем.
import { describe, expect, it } from 'vitest';
import { isInstant } from '../../../src/domain/time.ts';
import { systemClock } from '../../../src/server/clock.ts';

describe('T-005 К29: реальные часы', () => {
  it('T-005 К29: now() — канонический Instant между моментами до и после вызова', () => {
    const before = new Date().toISOString();
    const t = systemClock.now();
    const after = new Date().toISOString();
    expect(isInstant(t)).toBe(true);
    expect(t >= before && t <= after).toBe(true);
  });
});
