// T-005 К26, ADR-003 §8: производный id системного события = UUIDv5(NS, ключ). node:crypto — только здесь (ADR-004).
import { createHash } from 'node:crypto';

/** Не менять никогда: смена молча ломает идемпотентность уже записанных системных событий. */
export const NS = '3f6c2a9e-8b1d-4e57-a0c4-7d92e15b6f08';

/** RFC 4122 §4.3. */
export function uuidV5(namespace: string, name: string): string {
  const h = createHash('sha1').update(Buffer.from(namespace.replace(/-/g, ''), 'hex')).update(name, 'utf8').digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x50;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export const derivedId = (key: string): string => uuidV5(NS, key);
