// Smoke шага 0 (B-00a, ADR-001): Vitest запускается и разбирает TypeScript.
// Лежит в src/, потому что tests/ — зона tester; подключён в vitest.config.ts явно.
import { expect, test } from 'vitest';

type Pair = { readonly a: number; readonly b: number };

const add = ({ a, b }: Pair): number => a + b;

test('smoke: раннер и TypeScript работают', () => {
  expect(add({ a: 2, b: 3 })).toBe(5);
});
