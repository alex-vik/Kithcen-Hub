// B-00a: убеждаемся, что тестовый конвейер (tsc + vitest) работает и что
// встроенный Temporal доступен в рантайме — ADR-001 опирается на него для BR-27.
import { describe, expect, it } from 'vitest';

describe('B-00a smoke', () => {
  it('запускает тестовый конвейер', () => {
    expect(1 + 1).toBe(2);
  });

  it('предоставляет Temporal в рантайме', () => {
    expect(typeof Temporal).toBe('object');
    expect(typeof Temporal.Now.instant).toBe('function');

    const instant = Temporal.Now.instant();
    expect(instant).toBeInstanceOf(Temporal.Instant);
  });
});
