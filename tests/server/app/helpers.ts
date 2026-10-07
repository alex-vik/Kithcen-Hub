// T-005: общие помощники тестов сценариев записи. Не тест (имя без .test).
// Интерфейс app, заданный тестами (src/server/app/):
//   time.ts:  normalizeClientTime(v: unknown): Result<Instant>        // Result — как в domain/catalog: {ok,value}|{ok:false,error:{attribute}}
//   ids.ts:   NS: string; uuidV5(namespace: string, name: string): string; derivedId(key: string): string  // = uuidV5(NS, key)
//   write.ts: createWriteScenarios({ storage, clock }): {
//     recordEvent(input: ClientEventInput): ClientOutcome
//     recordSystemBatch(items: SystemItem[]): BatchOutcome }
//   ClientEventInput = { id, productId, kind, occurredAt: unknown(строка клиента), source, quantity?, value?, packs?, unitsPerPack?, targetId? }
//   ClientOutcome = { outcome: 'new'|'repeat', event } | { outcome: 'conflict', id, event } | { outcome: 'rejected', attribute }
//   SystemItem = { key: string, productId, kind, occurredAt: Instant, source, quantity?, ..., targetId? }
//   BatchOutcome = { outcome: 'ok', items: { outcome: 'new'|'done', event }[] } | { outcome: 'rejected', index: number, attribute }
//   clock.ts: systemClock: Clock
// Часы в тестах — поддельные: { now: () => t }.
import { createHash } from 'node:crypto';
import type { Instant } from '../../../src/domain/time.ts';
import type { StockEvent } from '../../../src/domain/journal.ts';
import { createWriteScenarios } from '../../../src/server/app/write.ts';
import type { StorageApi } from '../storage/helpers.ts';

export type EventBody = {
  productId: string;
  kind: string;
  occurredAt: unknown;
  source: string;
  quantity?: number;
  value?: number;
  packs?: number;
  unitsPerPack?: number;
  targetId?: string;
};
export type ClientInput = EventBody & { id: string };
export type ClientOutcome =
  | { outcome: 'new' | 'repeat'; event: StockEvent }
  | { outcome: 'conflict'; id: string; event: StockEvent }
  | { outcome: 'rejected'; attribute: string };
export type SystemItem = Omit<EventBody, 'occurredAt'> & { key: string; occurredAt: Instant };
export type BatchOutcome =
  | { outcome: 'ok'; items: { outcome: 'new' | 'done'; event: StockEvent }[] }
  | { outcome: 'rejected'; index: number; attribute: string };
export type Scenarios = {
  recordEvent(i: ClientInput): ClientOutcome;
  recordSystemBatch(items: SystemItem[]): BatchOutcome;
};

export type FakeClock = { now(): Instant; set(t: Instant): void };
export function fakeClock(t: Instant): FakeClock {
  let cur = t;
  return { now: () => cur, set: (x) => { cur = x; } };
}

export const makeScenarios = (storage: StorageApi, clock: { now(): Instant }): Scenarios =>
  (createWriteScenarios as unknown as (d: { storage: StorageApi; clock: { now(): Instant } }) => Scenarios)({ storage, clock });

/** Клиентский UUID v4 в нижнем регистре: n — 1..9999. */
export const v4 = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Независимая эталонная реализация UUIDv5 (RFC 4122 §4.3) — чтобы тесты не сверялись с кодом приложения. */
export function refV5(ns: string, name: string): string {
  const h = createHash('sha1').update(Buffer.from(ns.replace(/-/g, ''), 'hex')).update(name, 'utf8').digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x50;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return [x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20)].join('-');
}
export const NS_LITERAL = '3f6c2a9e-8b1d-4e57-a0c4-7d92e15b6f08';
