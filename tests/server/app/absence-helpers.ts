// T-012: помощники серверных тестов отпуска. Не тест (имя без .test).
// Контракт (docs/tasks/T-012, «Интерфейс»), заданный тестами:
//   Storage: addAbsencePeriod(p) -> { status: 'added'|'exists', period }; listAbsencePeriods(): AbsencePeriod[]
//   src/server/app/absence.ts: createAbsence({ storage, clock, params: { timeZone } }): { recordAbsence({ id, start, end }): AbsenceOutcome }
//   AbsenceOutcome = { outcome: 'new'|'repeat', period, cancelled } | { outcome: 'conflict', period } | { outcome: 'rejected', attribute }
// Модуль грузится динамически: пока его нет, падает каждый тест, а не весь файл.
import type { DatabaseSync } from 'node:sqlite';
import { stockBalance } from '../../../src/domain/journal.ts';
import type { StockEvent } from '../../../src/domain/journal.ts';
import { localTimeOn } from '../../../src/domain/time.ts';
import type { LocalDate } from '../../../src/domain/time.ts';
import { createProduct } from '../../../src/domain/catalog.ts';
import type { Product } from '../../../src/domain/catalog.ts';
import { JOB, makeAuto } from './auto-helpers.ts';
import type { AutoWriteoffApp, JobStorage } from './auto-helpers.ts';
import { fakeClock, makeScenarios, v4 } from './helpers.ts';
import type { FakeClock } from './helpers.ts';
import { openFile } from '../storage/helpers.ts';
import type { StorageApi } from '../storage/helpers.ts';

export { JOB, v4 };
export type Period = { id: string; start: LocalDate; end: LocalDate; recordedAt: string };
export type AbsenceOutcome =
  | { outcome: 'new' | 'repeat'; period: Period; cancelled: number }
  | { outcome: 'conflict'; period: Period }
  | { outcome: 'rejected'; attribute: string };
export type AbsenceApp = { recordAbsence(input: { id: unknown; start: unknown; end: unknown }): AbsenceOutcome };
export type AbsStorage = JobStorage & {
  addAbsencePeriod(p: Period): { status: 'added' | 'exists'; period: Period };
  listAbsencePeriods(): Period[];
};

export const PARAMS = { timeZone: 'Europe/Vilnius', autoWriteoffTime: '00:00' };
const URL_ABS = new URL('../../../src/server/app/absence.ts', import.meta.url).href;
export async function makeAbsence(storage: unknown, clock: { now(): string }): Promise<AbsenceApp> {
  const mod = (await import(/* @vite-ignore */ URL_ABS)) as {
    createAbsence: (d: { storage: unknown; clock: unknown; params: { timeZone: string } }) => AbsenceApp;
  };
  return mod.createAbsence({ storage, clock, params: { timeZone: PARAMS.timeZone } });
}

/** Местное время Вильнюса -> Instant. */
export const loc = (day: LocalDate, hhmm: string): string => localTimeOn(day, hhmm, PARAMS.timeZone);

function mk(id: string, type: Product['writeOffType'], norm: number, unit: 'г' | 'шт'): Product {
  const r = createProduct({ id, name: id, unit, packName: 'уп', unitsPerPack: 10, writeOffType: type, norm });
  if (!r.ok) throw new Error(`тест: позиция не создана: ${r.error.attribute}`);
  return r.value;
}

/** P (кофе, г, норма 20), Q (шт, норма 1) — ритмичные; B — burst. */
export function seedAbsence(storage: StorageApi): void {
  storage.addProduct(mk('P', 'rhythmic', 20, 'г'));
  storage.addProduct(mk('Q', 'rhythmic', 1, 'шт'));
  storage.addProduct(mk('B', 'burst', 100, 'г'));
}

/** Сцена: БД на файле, три позиции, поддельные часы, курсор автосписания `cursor`. */
export async function scene(startNow: string, cursor: LocalDate) {
  const f = openFile();
  const clock = fakeClock(startNow);
  const storage = f.storage as AbsStorage;
  seedAbsence(storage);
  storage.markJobDay(JOB, cursor);
  const auto: AutoWriteoffApp = await makeAuto(storage, clock);
  const abs = await makeAbsence(storage, clock);
  const write = makeScenarios(storage, clock);
  return { ...f, storage, clock, auto, abs, write };
}
export type Scene = Awaited<ReturnType<typeof scene>>;

export const events = (s: StorageApi, id: string): StockEvent[] => s.listStockEvents(id);
export const balance = (s: StorageApi, id: string): number => stockBalance(s.listStockEvents(id));
export const absCancels = (s: StorageApi, id: string): StockEvent[] =>
  s.listStockEvents(id).filter((e) => e.kind === 'cancel' && e.source === 'absence');
export const allAbsCancels = (raw: DatabaseSync): number =>
  Number((raw.prepare("SELECT COUNT(*) AS n FROM stock_event WHERE kind = 'cancel' AND source = 'absence'").get() as { n: number | bigint }).n);
export const periodRows = (raw: DatabaseSync): number =>
  Number((raw.prepare('SELECT COUNT(*) AS n FROM absence_period').get() as { n: number | bigint }).n);
export const jobDays = (raw: DatabaseSync): string[] =>
  (raw.prepare('SELECT day FROM job_runs WHERE job = ? ORDER BY day').all(JOB) as { day: string }[]).map((r) => r.day);
export const autoOf = (s: StorageApi, id: string): StockEvent[] => s.listStockEvents(id).filter((e) => e.kind === 'auto_writeoff');
/** Действующие автосписания (без отменённых): пары позиция/начало суток. */
export function effectiveAutos(s: StorageApi): string[] {
  const out: string[] = [];
  for (const id of ['P', 'Q']) {
    const evs = s.listStockEvents(id);
    const cancelled = new Set(evs.filter((e) => e.kind === 'cancel').map((e) => e.targetId));
    for (const e of evs) if (e.kind === 'auto_writeoff' && !cancelled.has(e.id)) out.push(`${id}@${e.occurredAt}`);
  }
  return out.sort();
}

/** Пример 3 ADR-003: инвентаризация 500 (10-08 23:00), автосписания 10-09…10-14 через runPending, инвентаризация 480 (10-13 22:00). */
export async function example3(withInventory480 = true) {
  const s = await scene(loc('2026-10-09', '00:00'), '2026-10-08');
  s.clock.set(loc('2026-10-15', '09:00'));
  s.auto.runPending();
  const inv = (id: number, at: string, value: number) => {
    const r = s.write.recordEvent({ id: v4(id), productId: 'P', kind: 'inventory', occurredAt: at, source: 'test', value });
    if (r.outcome !== 'new') throw new Error(`тест: инвентаризация не записана: ${JSON.stringify(r)}`);
  };
  inv(1, loc('2026-10-08', '23:00'), 500);
  if (withInventory480) inv(2, loc('2026-10-13', '22:00'), 480);
  return s;
}
export type { FakeClock };
