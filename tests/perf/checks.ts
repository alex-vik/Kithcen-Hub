// T-008 К16, К17: проверки, общие для общего набора (уменьшенный журнал) и npm run perf (полный).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { openStorage } from '../../src/server/storage/index.ts';
import { PERF } from './config.ts';
import { balancesInMemory, balancesViaStorage, generateJournal, groupByProduct, loadIntoStorage } from './journal.ts';
import type { Journal } from './journal.ts';

export function checkJournalShape(j: Journal, target: number): void {
  expect(j.products).toHaveLength(PERF.products);
  expect(j.products.filter((p) => p.writeOffType === 'rhythmic')).toHaveLength(PERF.rhythmic);
  expect(Math.abs(j.events.length - target)).toBeLessThanOrEqual(target * PERF.tolerance);
  for (const [id, list] of groupByProduct(j.events)) {
    expect(list.length, `событий у ${id}`).toBeLessThanOrEqual(PERF.maxPerProduct);
  }
  const kinds = new Set(j.events.map((e) => e.kind));
  for (const k of ['purchase', 'portion', 'auto_writeoff', 'recipe', 'spoilage', 'inventory', 'depleted', 'cancel']) {
    expect(kinds.has(k as never), `вид ${k}`).toBe(true);
  }
  const byId = new Map(j.events.map((e) => [e.id, e]));
  const cancelOfCancel = j.events.some((e) => e.kind === 'cancel' && byId.get(e.targetId as string)?.kind === 'cancel');
  expect(cancelOfCancel, 'отмена отмены').toBe(true);
}

export function checkDeterminism(target: number): void {
  const a = generateJournal(PERF.seed, target);
  const b = generateJournal(PERF.seed, target);
  const c = generateJournal(PERF.seed + 1, target);
  expect(b.events).toEqual(a.events);
  expect(c.events).not.toEqual(a.events);
}

/** Временная файловая БД; удаляется после fn. */
export function withTempDb<T>(fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 't008-'));
  try {
    return fn(join(dir, 'perf.db'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function checkDomainEqualsStorage(j: Journal): void {
  withTempDb((path) => {
    const storage = openStorage({ path, busyTimeoutMs: 5000 });
    try {
      loadIntoStorage(storage, j);
      const a = balancesInMemory(groupByProduct(j.events));
      const b = balancesViaStorage(storage);
      expect(a.size).toBe(PERF.products);
      expect(b.size).toBe(PERF.products);
      for (const [id, v] of a) expect(b.get(id), `остаток ${id}`).toBe(v);
    } finally {
      storage.close();
    }
  });
}
