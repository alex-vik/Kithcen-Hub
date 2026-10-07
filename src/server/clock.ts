// ADR-004, ADR-005. Единственное место, где сервер узнаёт текущее время.
// Домен часов не видит: прикладной слой берёт now() здесь и передаёт в домен параметром.
// Реальная и поддельная (для тестов и симулятора) реализации — по задачам.
import type { Instant } from '../domain/time.ts';

export interface Clock {
  now(): Instant;
}

/** T-005 К29, NFR-14: реальные часы; toISOString даёт канон YYYY-MM-DDTHH:mm:ss.sssZ. */
export const systemClock: Clock = { now: () => new Date().toISOString() };
