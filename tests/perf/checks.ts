// T-008 К16, К17: проверки, общие для общего набора (уменьшенный журнал) и npm run perf (полный).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { openStorage } from '../../src/server/storage/index.ts';
import type { Storage } from '../../src/server/storage/index.ts';
import { PERF } from './config.ts';
import {
  balancesInMemory, balancesViaStorage, freshEventsByProduct, generateJournal, groupByProduct, loadIntoStorage,
} from './journal.ts';
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
  // События в порядке seq = порядок recordedAt (тай-брейк — позиция); цель отмены раньше по seq.
  let prev = '';
  j.events.forEach((e, k) => {
    expect(e.seq, 'seq подряд').toBe(k + 1);
    expect(e.recordedAt >= prev, `порядок recordedAt у ${e.id}`).toBe(true);
    prev = e.recordedAt;
    if (e.kind === 'cancel') expect((byId.get(e.targetId as string) as { seq: number }).seq, `цель отмены ${e.id}`).toBeLessThan(e.seq);
  });
  expect(new Set(j.events.slice(0, 1000).map((e) => e.productId)).size, 'позиции чередуются').toBeGreaterThan(20);
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

/** Остатки в памяти (а) и через хранилище (б) совпадают для всех позиций; журнал уже загружен в storage. */
export function compareBalances(j: Journal, storage: Storage): void {
  const a = balancesInMemory(groupByProduct(j.events));
  const b = balancesViaStorage(storage);
  expect(a.size).toBe(PERF.products);
  expect(b.size).toBe(PERF.products);
  for (const [id, v] of a) expect(b.get(id), `остаток ${id}`).toBe(v);
}

export function checkDomainEqualsStorage(j: Journal): void {
  withTempDb((path) => {
    const storage = openStorage({ path, busyTimeoutMs: 5000 });
    try {
      loadIntoStorage(storage, j);
      compareBalances(j, storage);
    } finally {
      storage.close();
    }
  });
}

/** T-009 К16-доп.1: первое и последнее по recordedAt события каждой позиции — в крайних α периода журнала. */
export function checkPeriodAligned(j: Journal): void {
  const times = j.events.map((e) => Date.parse(e.recordedAt));
  // без Math.min(...): на 500 тыс. событий распаковка аргументов переполняет стек
  const from = times.reduce((a, b) => Math.min(a, b), Infinity);
  const to = times.reduce((a, b) => Math.max(a, b), -Infinity);
  const alpha = PERF.alignAlpha * (to - from);
  expect(to - from, 'период журнала не вырожден').toBeGreaterThan(0);
  const byProduct = groupByProduct(j.events);
  expect(byProduct.size).toBe(PERF.products);
  for (const [id, list] of byProduct) {
    const ts = list.map((e) => Date.parse(e.recordedAt));
    expect(Math.min(...ts) - from, `первое событие ${id} в первых α`).toBeLessThanOrEqual(alpha);
    expect(to - Math.max(...ts), `последнее событие ${id} в последних α`).toBeLessThanOrEqual(alpha);
  }
}

/** T-009 К16-доп.2: в окнах по windowSize событий подряд (по seq) — начало, середина, конец — позиций больше minDistinct. */
export function checkWindowsInterleaved(j: Journal): void {
  const n = j.events.length;
  const mid = Math.floor((n - PERF.windowSize) / 2);
  const starts: Array<[string, number]> = [['начало', 0], ['середина', mid], ['конец', n - PERF.windowSize]];
  for (const [name, from] of starts) {
    const window = j.events.slice(from, from + PERF.windowSize);
    expect(window, `окно «${name}»`).toHaveLength(PERF.windowSize);
    expect(new Set(window.map((e) => e.productId)).size, `позиций в окне «${name}»`).toBeGreaterThan(PERF.windowDistinct);
  }
}

/**
 * T-009 К16-доп.3: вход пути (а) — новые объекты, равные по значению событиям журнала; остатки совпадают со свёрткой К17.
 * storage — уже загруженное хранилище (полный объём, чтобы не грузить журнал дважды); без него журнал грузится во временную БД.
 */
export function checkFreshObjects(j: Journal, loaded?: Storage): void {
  const fresh = freshEventsByProduct(j);
  const original = groupByProduct(j.events);
  expect(fresh.size).toBe(original.size);
  for (const [id, list] of original) {
    const copy = fresh.get(id) ?? [];
    expect(copy, `события ${id}`).toHaveLength(list.length);
    list.forEach((e, k) => {
      expect(copy[k], `событие ${e.id}: те же значения`).toEqual(e);
      expect(copy[k], `событие ${e.id}: не та же ссылка`).not.toBe(e);
    });
  }
  const compare = (storage: Storage): void => {
    const a = balancesInMemory(fresh);
    const b = balancesViaStorage(storage);
    expect(a.size).toBe(PERF.products);
    for (const [id, v] of b) expect(a.get(id), `остаток ${id}`).toBe(v);
  };
  if (loaded) {
    compare(loaded);
    return;
  }
  withTempDb((path) => {
    const storage = openStorage({ path, busyTimeoutMs: 5000 });
    try {
      loadIntoStorage(storage, j);
      compare(storage);
    } finally {
      storage.close();
    }
  });
}
