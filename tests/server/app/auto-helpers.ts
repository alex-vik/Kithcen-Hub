// T-010: помощники серверных тестов автосписания. Не тест (имя без .test).
// Контракт (docs/tasks/T-010, «Интерфейс»), заданный тестами:
//   Storage: lastJobDay(job): LocalDate | undefined; markJobDay(job, day): void; таблица job_runs(job, day), PK (job, day)
//   src/server/app/auto-writeoff.ts: createAutoWriteoff({ storage, clock, params }): { runPending(): { processed: LocalDate[] } }
//   src/server/jobs/scheduler.ts: startScheduler({ autoWriteoff, balances, log, tickMinutes }): { tick(), stop() }
// Модули загружаются динамически: пока их нет, падает каждый тест, а не весь файл.
import type { DatabaseSync } from 'node:sqlite';
import type { LocalDate } from '../../../src/domain/time.ts';
import type { StockEvent } from '../../../src/domain/journal.ts';
import { createProduct } from '../../../src/domain/catalog.ts';
import type { Product } from '../../../src/domain/catalog.ts';
import { cleanup, nth, openFile, state } from '../storage/helpers.ts';
import type { StorageApi, WriteResult } from '../storage/helpers.ts';
import { fakeClock } from './helpers.ts';
import type { FakeClock } from './helpers.ts';

export { cleanup, nth, fakeClock };
export type { FakeClock };

export const JOB = 'auto_writeoff';
export const PARAMS = { timeZone: 'Europe/Vilnius', autoWriteoffTime: '00:00' };
export type Params = typeof PARAMS;

export type JobStorage = StorageApi & {
  lastJobDay(job: string): LocalDate | undefined;
  markJobDay(job: string, day: LocalDate): void;
  maxStockSeq(): number;
  inTransaction(): boolean;
};
export type AutoWriteoffApp = { runPending(): { processed: LocalDate[] } };

const URL_APP = new URL('../../../src/server/app/auto-writeoff.ts', import.meta.url).href;
export async function makeAuto(storage: unknown, clock: { now(): string }, params: Params = PARAMS): Promise<AutoWriteoffApp> {
  const mod = (await import(/* @vite-ignore */ URL_APP)) as {
    createAutoWriteoff: (d: { storage: unknown; clock: unknown; params: Params }) => AutoWriteoffApp;
  };
  return mod.createAutoWriteoff({ storage, clock, params });
}

export type Scheduler = { tick(): void; stop(): void };
export type SchedulerDeps = {
  autoWriteoff: AutoWriteoffApp;
  balances: { warm(): void };
  log: (message: string, error: unknown) => void;
  tickMinutes: number;
};
const URL_SCHED = new URL('../../../src/server/jobs/scheduler.ts', import.meta.url).href;
export async function makeScheduler(deps: SchedulerDeps): Promise<Scheduler> {
  const mod = (await import(/* @vite-ignore */ URL_SCHED)) as { startScheduler: (d: SchedulerDeps) => Scheduler };
  return mod.startScheduler(deps);
}

function mk(id: string, type: Product['writeOffType'], norm: number | null, unit: 'г' | 'мл' | 'шт'): Product {
  const r = createProduct({ id, name: id, unit, packName: 'уп', unitsPerPack: 10, writeOffType: type, norm });
  if (!r.ok) throw new Error(`тест: позиция не создана: ${r.error.attribute}`);
  return r.value;
}

/** Каталог из «Дано для А1–А11»: p1 (250 мл) и p2 (1 шт) ритмичные; pb burst; pn без нормы; pi неактивна. */
export function seedCatalog(storage: StorageApi): void {
  storage.addProduct(mk('p1', 'rhythmic', 250, 'мл'));
  storage.addProduct(mk('p2', 'rhythmic', 1, 'шт'));
  storage.addProduct(mk('pb', 'burst', 100, 'г'));
  storage.addProduct(mk('pn', 'rhythmic', null, 'г'));
  storage.addProduct(mk('pi', 'rhythmic', 30, 'г'));
  storage.addStateEvent(state('pi', 'st-pi-1', '2026-01-01T10:00:00.000Z', 'inactive', 'user_button'));
}

export function setup(startNow: string) {
  const f = openFile();
  const storage = f.storage as JobStorage;
  seedCatalog(storage);
  const clock = fakeClock(startNow);
  return { ...f, storage, clock };
}

export const autos = (s: StorageApi, productId: string): StockEvent[] =>
  s.listStockEvents(productId).filter((e) => e.kind === 'auto_writeoff');

export const totalEvents = (raw: DatabaseSync): number =>
  Number((raw.prepare('SELECT COUNT(*) AS n FROM stock_event').get() as { n: number | bigint }).n);

export const addMinutes = (iso: string, m: number): string => new Date(Date.parse(iso) + m * 60_000).toISOString();

/** Тики каждые 15 минут: для каждых суток — первый now, на котором они вошли в processed. */
export async function runTicks(
  app: AutoWriteoffApp, clock: FakeClock, from: string, to: string,
): Promise<Map<LocalDate, string>> {
  const first = new Map<LocalDate, string>();
  for (let t = from; t <= to; t = addMinutes(t, 15)) {
    clock.set(t);
    for (const d of app.runPending().processed) {
      if (first.has(d)) throw new Error(`тест: сутки ${d} обработаны повторно на ${t}`);
      first.set(d, t);
    }
  }
  return first;
}

/** Обёртка: addStockEvent второй позиции (p2) за сутки с началом `failAt` — исключение или отказ. */
export type Fault = { mode: 'off' | 'throw' | 'reject'; failAt: string };
export function faulty(storage: JobStorage, fault: Fault): JobStorage {
  return {
    ...storage,
    addStockEvent: (e: StockEvent): WriteResult<StockEvent> => {
      if (fault.mode !== 'off' && e.productId === 'p2' && e.occurredAt === fault.failAt) {
        if (fault.mode === 'throw') throw new Error('сбой хранилища (тест)');
        return { status: 'rejected', reason: 'unknown_product' };
      }
      return storage.addStockEvent(e);
    },
  };
}
