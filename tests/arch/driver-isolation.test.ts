// T-004 К18: node:sqlite импортируется только из src/server/storage/ (ADR-002, ADR-004).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../../src/', import.meta.url).pathname;
const STORAGE = join(SRC, 'server', 'storage') + sep;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
}

/** import/export from, import(), require() с node:sqlite или sqlite. */
export const importsDriver = (code: string): boolean =>
  /(?:from|import|require)\s*\(?\s*['"](?:node:)?sqlite['"]/.test(code);

describe('T-004 К18: драйвер не виден за пределами хранилища', () => {
  it('T-004 К18: распознавание импорта работает на всех формах', () => {
    expect(importsDriver("import { DatabaseSync } from 'node:sqlite';")).toBe(true);
    expect(importsDriver('import {x} from "node:sqlite"')).toBe(true);
    expect(importsDriver("const m = await import('node:sqlite');")).toBe(true);
    expect(importsDriver("const m = require('node:sqlite');")).toBe(true);
    expect(importsDriver("import fs from 'node:fs';")).toBe(false);
  });

  it('T-004 К18: вне src/server/storage/ node:sqlite не импортируется', () => {
    const offenders = walk(SRC)
      .filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f))
      .filter((f) => !f.startsWith(STORAGE))
      .filter((f) => importsDriver(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('T-004 К18: драйвер действительно используется внутри src/server/storage/', () => {
    const inside = walk(SRC).filter((f) => f.startsWith(STORAGE) && f.endsWith('.ts'));
    expect(inside.some((f) => importsDriver(readFileSync(f, 'utf8')))).toBe(true);
  });
});
