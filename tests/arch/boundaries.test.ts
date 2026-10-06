// B-00e: тест-страж границ модулей, ADR-004 разд. 9.3 (правила D1, D2, D4, W1, W2, S1, S2).
// D3 проверяет компилятор (tsconfig.domain.json), здесь его нет.
// Это не тест критерия приёмки: красную фазу заменяют образцы нарушителей (ADR-004, В-2).
import { readdirSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOMAIN = 'src/domain';
const SERVER = 'src/server';
const WEB = 'src/web';

type SourceFile = { path: string; code: string };
type Violation = { file: string; rule: string; token: string };

/** Все строки-спецификаторы: from '…', import '…', import('…'), export … from '…'. */
function specifiers(code: string): string[] {
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"`])([^'"`\n]+)\1/g;
  return [...code.matchAll(re)].map((m) => m[2]!);
}

/** Спецификаторы того, что реально исполняется после стирания типов. */
function valueSpecifiers(code: string): string[] {
  return specifiers(stripTypeScriptTypes(code));
}

/** Путь относительного спецификатора от корня репозитория (posix), либо null. */
function resolveRel(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const abs = path.resolve(ROOT, path.dirname(file), spec);
  return path.relative(ROOT, abs).split(path.sep).join('/');
}

const inside = (p: string, dir: string) => p === dir || p.startsWith(dir + '/');

const D2_PATTERNS: [RegExp, string][] = [
  [/\bDate\b/, 'Date'],
  [/Temporal\s*\.\s*Now/, 'Temporal.Now'],
  [/Math\s*\.\s*random/, 'Math.random'],
  [/\bglobalThis\b/, 'globalThis'],
  [/\bimport\s*\(/, 'import('],
];
const S2_PATTERNS: [RegExp, string][] = [
  [/Temporal\s*\.\s*Now/, 'Temporal.Now'],
  [/Date\s*\.\s*now/, 'Date.now'],
  [/new\s+Date\b/, 'new Date'],
];

export function violations(files: SourceFile[]): Violation[] {
  const out: Violation[] = [];
  const add = (file: string, rule: string, token: string) => out.push({ file, rule, token });

  for (const { path: file, code } of files) {
    const isDomain = inside(file, DOMAIN);
    const isServer = inside(file, SERVER);
    const isWeb = inside(file, WEB);
    const specs = specifiers(code);

    if (isDomain) {
      for (const s of specs) {
        const r = resolveRel(file, s);
        if (r === null || !inside(r, DOMAIN)) add(file, 'D1', s);
      }
      for (const [re, name] of D2_PATTERNS) if (re.test(code)) add(file, 'D2', name);
      if (file !== `${DOMAIN}/config.ts`) {
        for (const s of valueSpecifiers(code)) {
          if (resolveRel(file, s) === `${DOMAIN}/config.ts`) add(file, 'D4', s);
        }
      }
    }

    if (isWeb) {
      for (const s of valueSpecifiers(code)) {
        const r = resolveRel(file, s);
        if (r !== null && (inside(r, DOMAIN) || inside(r, SERVER))) add(file, 'W1', s);
      }
      for (const s of specs) if (s.startsWith('node:')) add(file, 'W2', s);
    }

    if (isDomain || isServer || isWeb) {
      if (!inside(file, `${SERVER}/db`)) {
        for (const s of specs) if (s === 'better-sqlite3' || s === 'node:sqlite') add(file, 'S1', s);
      }
    }

    if (isServer && file !== `${SERVER}/main.ts`) {
      for (const [re, name] of S2_PATTERNS) if (re.test(code)) add(file, 'S2', name);
    }
  }
  return out;
}

const f = (p: string, code: string): SourceFile => ({ path: p, code });
const rulesOf = (files: SourceFile[]) => violations(files).map((v) => v.rule);

describe('B-00e контрольный пример стирания типов', () => {
  it('import type стирается, встроенный type остаётся (основа W1)', () => {
    expect(stripTypeScriptTypes("import type { A } from './x.ts'")).not.toContain('./x.ts');
    expect(stripTypeScriptTypes("import { type A } from './x.ts'")).toContain('./x.ts');
    expect(stripTypeScriptTypes("export type { A } from './x.ts'")).not.toContain('./x.ts');
  });
});

describe('B-00e образцы нарушителей: каждое правило ловит свой', () => {
  it('D1: пакет, node:*, server, web, выход из домена, import type тоже', () => {
    for (const code of [
      "import { x } from 'lodash';",
      "import fs from 'node:fs';",
      "import { s } from '../server/app.ts';",
      "import { w } from '../web/config.ts';",
      "import type { T } from '../server/api/contract.ts';",
      "export { y } from '../../tests/support/x.ts';",
      "import './../outside.ts';",
      "import 'node:fs';",
    ]) {
      expect(rulesOf([f('src/domain/stock.ts', code)]), code).toContain('D1');
    }
  });

  it('D1: многострочный импорт и динамический import с литералом', () => {
    expect(rulesOf([f('src/domain/a.ts', "import {\n  a,\n  b,\n} from 'node:fs';")])).toContain('D1');
    expect(rulesOf([f('src/domain/a.ts', "const m = await import('node:fs');")])).toContain('D1');
  });

  it.each([
    ['Date как слово', 'const d = new Date(0);', 'Date'],
    ['Date.now', 'const t = Date.now();', 'Date'],
    ['Temporal.Now', 'const t = Temporal.Now.instant();', 'Temporal.Now'],
    ['Temporal . Now с пробелами', 'const t = Temporal . Now.instant();', 'Temporal.Now'],
    ['Math.random', 'const r = Math.random();', 'Math.random'],
    ['globalThis', 'const t = globalThis.Temporal;', 'globalThis'],
    ['динамический import с вычисляемым путём', 'const m = import(name);', 'import('],
  ])('D2: %s', (_n, code, token) => {
    const v = violations([f('src/domain/auto.ts', code)]).filter((x) => x.rule === 'D2');
    expect(v.map((x) => x.token)).toContain(token);
  });

  it('D4: значение из config.ts запрещено, форма и встроенный type — по семантике', () => {
    const bad = [
      "import { defaultConfig } from './config.ts';",
      "import { type DomainConfig, defaultConfig } from './config.ts';",
      "import { type DomainConfig } from './config.ts';", // оставляет import {} from — модуль загружается
      "export { defaultConfig } from './config.ts';",
      "import * as c from '../domain/config.ts';",
    ];
    for (const code of bad) expect(rulesOf([f('src/domain/auto.ts', code)]), code).toContain('D4');
  });

  it('W1: значения из domain и server запрещены, в том числе встроенный type', () => {
    for (const code of [
      "import { balance } from '../domain/stock.ts';",
      "import { type Product } from '../domain/catalog.ts';",
      "import { createApp } from '../server/app.ts';",
      "export { balance } from '../domain/stock.ts';",
      "import '../domain/stock.ts';",
      "import * as d from '../domain/stock.ts';",
    ]) {
      expect(rulesOf([f('src/web/app.ts', code)]), code).toContain('W1');
    }
  });

  it('W2: node:* в клиенте', () => {
    expect(rulesOf([f('src/web/app.ts', "import fs from 'node:fs';")])).toContain('W2');
    expect(rulesOf([f('src/web/app.ts', "import type { X } from 'node:path';")])).toContain('W2');
  });

  it('S1: драйвер вне src/server/db/ (server, domain, web)', () => {
    for (const p of ['src/server/services/stock.ts', 'src/server/app.ts', 'src/server/db.ts', 'src/web/a.ts']) {
      expect(rulesOf([f(p, "import Database from 'better-sqlite3';")]), p).toContain('S1');
      expect(rulesOf([f(p, "import { DatabaseSync } from 'node:sqlite';")]), p).toContain('S1');
    }
  });

  it.each([
    ['Temporal.Now', 'const t = Temporal.Now.instant();'],
    ['Date.now', 'const t = Date.now();'],
    ['new Date', 'const d = new Date();'],
  ])('S2: %s в сервере вне main.ts', (_n, code) => {
    for (const p of ['src/server/scheduler.ts', 'src/server/services/x.ts', 'src/server/db/open.ts']) {
      expect(rulesOf([f(p, code)]), p).toContain('S2');
    }
  });

  it('сообщение о нарушении содержит файл, правило и токен', () => {
    expect(violations([f('src/domain/a.ts', "import x from 'node:fs';")])).toContainEqual({
      file: 'src/domain/a.ts',
      rule: 'D1',
      token: 'node:fs',
    });
  });
});

describe('B-00e разрешённые формы не дают нарушений', () => {
  it('домен: относительные импорты внутри домена, import type из config.ts, Temporal без Now', () => {
    const code = [
      "import type { Milli } from './quantity.ts';",
      "import type { DomainConfig } from './config.ts';",
      "export type { CommandResult } from './result.ts';",
      'const d = Temporal.PlainDate.from("2026-10-25");',
      'const i = Temporal.Instant.from("2026-10-25T21:59:59.999Z");',
    ].join('\n');
    expect(violations([f('src/domain/auto.ts', code)])).toEqual([]);
  });

  it('домен: config.ts сам и реэкспорт значения из config.ts внутри config.ts', () => {
    expect(violations([f('src/domain/config.ts', 'export const defaultConfig = { a: 1 } as const;')])).toEqual([]);
  });

  it('сервер: домен значениями и типами, драйвер в db/, Temporal.Now в main.ts', () => {
    expect(
      violations([
        f('src/server/services/stock.ts', "import { balance } from '../../domain/stock.ts';\nimport type { Db } from '../db/open.ts';"),
        f('src/server/db/open.ts', "import Database from 'better-sqlite3';"),
        f('src/server/db/x.ts', "import { DatabaseSync } from 'node:sqlite';"),
        f('src/server/main.ts', "const clock = () => Temporal.Now.instant();\nconst d = Date.now();\nconst n = new Date();"),
        f('src/server/scheduler.ts', "import { defaultConfig } from '../domain/config.ts';\nimport { Hono } from 'hono';"),
      ]),
    ).toEqual([]);
  });

  it('клиент: import type / export type из domain и server, свои файлы, пакеты', () => {
    expect(
      violations([
        f(
          'src/web/screen.ts',
          [
            "import type { Product } from '../domain/catalog.ts';",
            "export type { Milli } from '../domain/quantity.ts';",
            "import type { AppType } from '../server/api/contract.ts';",
            "import { kioskReturnSeconds } from './config.ts';",
            "import { h } from 'preact';",
          ].join('\n'),
        ),
      ]),
    ).toEqual([]);
  });
});

function listTs(dir: string): SourceFile[] {
  const abs = path.join(ROOT, dir);
  let names: string[];
  try {
    names = readdirSync(abs, { recursive: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.ts'))
    .map((n) => {
      const rel = `${dir}/${n.split(path.sep).join('/')}`;
      return { path: rel, code: readFileSync(path.join(ROOT, rel), 'utf8') };
    });
}

describe('B-00e реальный src/', () => {
  it('нарушений границ нет', () => {
    const files = [...listTs(DOMAIN), ...listTs(SERVER), ...listTs(WEB)];
    expect(files.length, 'проверка должна видеть файлы src/domain').toBeGreaterThan(0);
    expect(violations(files)).toEqual([]);
  });

  it('src/domain видит страж (каркас T-001 в списке)', () => {
    expect(listTs(DOMAIN).map((x) => x.path)).toContain('src/domain/result.ts');
  });
});
