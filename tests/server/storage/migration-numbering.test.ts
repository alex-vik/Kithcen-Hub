// T-004 К3/К4: файлы миграций NNNN_*.sql нумеруются подряд с 0001 (ADR-002).
// Каталог миграций подменяется на уровне node:fs: реализация читает его только при openStorage без параметра migrations.
import { afterEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ files: [] as string[] }));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const isMig = (p: unknown): boolean => String(p).includes('/storage/migrations/');
  return {
    ...real,
    readdirSync: ((p: unknown, ...rest: unknown[]) =>
      isMig(p) ? fake.files : (real.readdirSync as (...a: unknown[]) => unknown)(p, ...rest)) as typeof real.readdirSync,
    readFileSync: ((p: unknown, ...rest: unknown[]) =>
      isMig(p)
        ? `CREATE TABLE ${/(\d{4})_/.exec(String(p))?.[1] ? 't' + /(\d{4})_/.exec(String(p))?.[1] : 'tx'} (a INTEGER) STRICT;`
        : (real.readFileSync as (...a: unknown[]) => unknown)(p, ...rest)) as typeof real.readFileSync,
  };
});

afterEach(() => {
  fake.files = [];
  vi.resetModules();
});

async function openDefault() {
  vi.resetModules();
  const { openStorage } = await import('../../../src/server/storage/index.ts');
  return openStorage({ path: ':memory:', busyTimeoutMs: 5000 });
}

describe('T-004 К3: нумерация файлов миграций подряд', () => {
  it('T-004 К3: 0001, 0002 — открывается, user_version 2 (контроль подмены)', async () => {
    fake.files = ['0002_b.sql', '0001_a.sql'];
    const s = await openDefault();
    expect(s.pragmas().userVersion).toBe(2);
    s.close();
  });

  it('T-004 К3: пропуск (0001, 0003) — исключение', async () => {
    fake.files = ['0001_a.sql', '0003_c.sql'];
    await expect(openDefault()).rejects.toThrow();
  });

  it('T-004 К4: нумерация не с 0001 (0002) — исключение', async () => {
    fake.files = ['0002_b.sql'];
    await expect(openDefault()).rejects.toThrow();
  });

  it('T-004 К4: дубль номера (0001, 0001) — исключение', async () => {
    fake.files = ['0001_a.sql', '0001_b.sql'];
    await expect(openDefault()).rejects.toThrow();
  });
});
