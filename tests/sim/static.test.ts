// T-006 К3 (статическая проверка): симулятор не берёт время и случайность из окружения и не знает сервера.
// Файл охватывает весь tests/sim/, включая модули T-007; сам исключён из просмотра (содержит образцы запрещённого).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = new URL('./', import.meta.url).pathname;
const SELF = 'static.test.ts';

const FORBIDDEN: [string, RegExp][] = [
  ['Math.random', /Math\s*\.\s*random/],
  ['Date.now', /Date\s*\.\s*now/],
  ['new Date() без аргумента', /new\s+Date\s*\(\s*\)/],
  ['импорт src/server', /(?:from|import|require)\s*\(?\s*['"][^'"]*\bserver\//],
];

export const violations = (code: string): string[] => FORBIDDEN.filter(([, re]) => re.test(code)).map(([n]) => n);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
}

describe('T-006 К3: статическая проверка tests/sim/', () => {
  it('T-006 К3: распознаватель ловит запрещённое и не ругается на допустимое', () => {
    expect(violations('const x = Math.random();')).toEqual(['Math.random']);
    expect(violations('Date.now()')).toEqual(['Date.now']);
    expect(violations('const d = new Date( );')).toEqual(['new Date() без аргумента']);
    expect(violations("import { app } from '../../src/server/app.ts';")).toEqual(['импорт src/server']);
    expect(violations("const m = await import('../server/x.ts');")).toEqual(['импорт src/server']);
    expect(violations('new Date(Date.UTC(2026, 0, 1))')).toEqual([]);
    expect(violations("import { createProduct } from '../../src/domain/catalog.ts';")).toEqual([]);
  });

  it('T-006 К3: в tests/sim/ нет запрещённого', () => {
    const files = walk(DIR).filter((f) => /\.(ts|tsx|js|mjs)$/.test(f) && !f.endsWith(`/${SELF}`));
    expect(files.length).toBeGreaterThan(5);
    const offenders = files.flatMap((f) => violations(readFileSync(f, 'utf8')).map((v) => `${f}: ${v}`));
    expect(offenders).toEqual([]);
  });
});
