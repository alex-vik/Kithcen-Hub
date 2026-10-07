import { describe, expect, it } from 'vitest';
import { computeG1, type UnmetEntry } from './g1.ts';
import { addDays, localToInstant } from './local-time.ts';

const START = '2026-01-05';
const at = (day: number, time = '12:00') => localToInstant(addDays(START, day), time);
const u = (productId: string, day: number, quantity = 40): UnmetEntry => ({ productId, at: at(day), quantity });
const buy = (day: number) => at(day, '11:00');
const g1 = (unmet: UnmetEntry[], schedule: string[], days = 120) => computeG1({ unmet, schedule, startDate: START, days });

describe('T-007 К12: подсчёт G-1 (Q-31)', () => {
  const unmet = [u('A', 3), u('A', 4), u('A', 5), u('A', 20), u('B', 100)];
  const purchases = [buy(7)];

  it('T-007 К12: эпизоды — A: два, B: один; позиция-суток 5', () => {
    const r = g1(unmet, purchases);
    expect(r.cases).toBe(3);
    expect(r.unmetProductDays).toBe(5);
  });
  it('T-007 К12: в месяц 3 × 30 / 120 = 0,75; худшее 90-суточное окно — 2', () => {
    const r = g1(unmet, purchases);
    expect(r.perMonth).toBeCloseTo(0.75, 10);
    expect(r.worst90).toBe(2);
  });
  it('T-007 К12: покупка, не покрывшая спрос, закрывает эпизод — у C два случая', () => {
    expect(g1([u('C', 50), u('C', 52)], [buy(51)]).cases).toBe(2);
    expect(g1([u('C', 50), u('C', 52)], []).cases).toBe(1);
  });
  it('T-007 К12 (Q-31 уточн.): эпизод кончается плановой закупкой, куплена позиция или нет — расписание общее для всех позиций', () => {
    // «забытый» продукт: нехватка каждые сутки, закупки на сутки 7 и 14 его не покупают — случай на каждую закупку
    const forgotten = Array.from({ length: 20 }, (_, d) => u('A', d + 1));
    expect(g1(forgotten, [buy(7), buy(14)]).cases).toBe(3);
    expect(g1(forgotten, []).cases).toBe(1);
    expect(g1([u('C', 50), u('D', 52)], [buy(51)]).cases).toBe(2);
  });
  it('T-007 К12: частичная нехватка (спрос 40, остаток 10, неудовлетворено 30) — один случай', () => {
    const r = g1([u('A', 10, 30)], []);
    expect(r.cases).toBe(1);
    expect(r.unmetProductDays).toBe(1);
  });
  it('T-007 К12: нет нехватки — нули; окно длиннее периода не ломает счёт', () => {
    expect(g1([], [buy(1)])).toEqual({ cases: 0, perMonth: 0, worst90: 0, unmetProductDays: 0 });
    expect(g1([u('A', 3), u('B', 5)], [], 30).worst90).toBe(2);
  });
  it('T-007 К12: эпизод относится к окну по своему началу, а не по продолжению', () => {
    const r = g1([u('A', 0), u('A', 95), u('B', 100)], [buy(50)], 120);
    expect(r.cases).toBe(3);
    expect(r.worst90).toBe(2);
  });
  it('T-007 К12: покупка в тот же момент, что и нехватка, идёт первой и закрывает прежний эпизод', () => {
    const tie = at(52);
    expect(g1([u('C', 50), u('C', 52)], [tie]).cases).toBe(2);
  });
  it('T-007 К12: покупка в момент прежней нехватки (раньше неё) эпизод не разрывает', () => {
    expect(g1([u('C', 50), u('C', 52)], [at(50)]).cases).toBe(1);
  });
  it('T-007 К12: единственный эпизод в последние сутки прогона (days > 90) — worst90 = 1', () => {
    expect(g1([u('A', 119)], [], 120).worst90).toBe(1);
    expect(g1([u('A', 90)], [], 91).worst90).toBe(1);
    expect(g1([u('A', 89)], [], 90).worst90).toBe(1);
    expect(g1([u('A', 0)], [], 120).worst90).toBe(1);
  });
  it('T-007 К12: день эпизода — по местной дате (нехватка в 00:30 местного у границы окна)', () => {
    const early = (productId: string, day: number): UnmetEntry => ({ productId, at: at(day, '00:30'), quantity: 5 });
    // сутки 90 по местному времени: в UTC это ещё сутки 89 и окно 0..89 включило бы оба эпизода
    expect(g1([u('A', 0), early('A', 90)], [buy(50)], 120).worst90).toBe(1);
    expect(g1([u('A', 0), early('A', 89)], [buy(50)], 120).worst90).toBe(2);
    expect(g1([early('A', 3), u('A', 3, 5)], [], 120).unmetProductDays).toBe(1);
    expect(g1([{ productId: 'A', at: at(2, '23:30'), quantity: 5 }, early('A', 3)], [], 120).unmetProductDays).toBe(2);
  });
  it('T-007 К12: окно 90 суток — эпизоды с началами в сутки 0 и 90 не в одном окне', () => {
    expect(g1([u('A', 0), u('A', 90)], [buy(50)], 120).worst90).toBe(1);
    expect(g1([u('A', 0), u('A', 89)], [buy(50)], 120).worst90).toBe(2);
  });
  it('T-007 К12: позиция-сутки — разные позиции в одни сутки считаются отдельно', () => {
    expect(g1([u('A', 3), u('B', 3), u('B', 3)], []).unmetProductDays).toBe(2);
  });
});
