// T-012 Д1–Д8: период отсутствия, пропуск автосписаний, поиск отменяемых автосписаний (FR-ABS-01…04, BR-27, NFR-16).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelledIds } from '../../src/domain/journal.ts';
import { auto, DEFAULTS, prod } from './auto-helpers.ts';
import {
  absence, autoEv, autoId, baseJournal, deepFreeze, ev, isLocalDate, P, period, Q, REC, VILNIUS,
} from './absence-helpers.ts';
import { nth } from '../server/storage/helpers.ts';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('T-012 Д1: isLocalDate', () => {
  it.each(['2026-10-07', '2028-02-29', '2026-12-31'])('T-012 Д1: %s — true', (v) => {
    expect(isLocalDate(v)).toBe(true);
  });
  it.each(['2026-02-29', '2026-13-01', '2026-10-7', '2026-10-07T00:00:00.000Z', '', '20261007', 20261007, undefined, null])(
    'T-012 Д1: %j — false', (v) => {
      expect(isLocalDate(v)).toBe(false);
    });
});

describe('T-012 Д2: createAbsencePeriod', () => {
  const ok = { id: 'ab-1', start: '2026-10-10', end: '2026-10-13', recordedAt: REC };
  const attr = (r: { ok: boolean; error?: { attribute: string } }): string | undefined => (r.ok ? undefined : r.error?.attribute);

  it('T-012 Д2: однодневный период (start = end) — ok, поля сохранены', async () => {
    const a = await absence();
    const r = a.createAbsencePeriod({ ...ok, start: '2026-10-10', end: '2026-10-10' });
    expect(r).toEqual({ ok: true, value: { id: 'ab-1', start: '2026-10-10', end: '2026-10-10', recordedAt: REC } });
  });

  it('T-012 Д2: прошлый и будущий периоды — ok (FR-ABS-02)', async () => {
    const a = await absence();
    expect(a.createAbsencePeriod({ ...ok, start: '2020-01-01', end: '2020-01-05' }).ok).toBe(true);
    expect(a.createAbsencePeriod({ ...ok, start: '2030-07-01', end: '2030-07-14' }).ok).toBe(true);
  });

  it.each([
    ['end < start', { start: '2026-10-13', end: '2026-10-10' }, 'end'],
    ['несуществующий start', { start: '2026-02-30' }, 'start'],
    ['end не дата', { end: 'завтра' }, 'end'],
    ['id из пробелов', { id: '  ' }, 'id'],
    ['пустой id', { id: '' }, 'id'],
    ['recordedAt — дата, не момент', { recordedAt: '2026-10-15' }, 'recordedAt'],
  ])('T-012 Д2: %s → отказ %s', async (_n, patch, attribute) => {
    const a = await absence();
    expect(attr(a.createAbsencePeriod({ ...ok, ...patch }) as never)).toBe(attribute);
  });

  it('T-012 Д2: невалидный ввод не бросает исключений', async () => {
    const a = await absence();
    for (const bad of [{}, { ...ok, start: 5 }, { ...ok, end: undefined }, { ...ok, id: 7 }, { ...ok, recordedAt: null }]) {
      expect(() => a.createAbsencePeriod(bad)).not.toThrow();
      expect(a.createAbsencePeriod(bad).ok).toBe(false);
    }
  });
});

describe('T-012 Д3: isAbsenceDay — границы включительно', () => {
  const ps = [period('2026-10-10', '2026-10-13', 'a'), period('2026-10-20', '2026-10-20', 'b')];
  it.each([['2026-10-10', true], ['2026-10-11', true], ['2026-10-13', true], ['2026-10-20', true],
    ['2026-10-09', false], ['2026-10-14', false], ['2026-10-19', false], ['2026-10-21', false]])(
    'T-012 Д3: %s → %s', async (d, exp) => {
      expect((await absence()).isAbsenceDay(d, ps)).toBe(exp);
    });

  it('T-012 Д3: пустой список — false', async () => {
    expect((await absence()).isAbsenceDay('2026-10-10', [])).toBe(false);
  });

  it('T-012 Д3: пересекающиеся периоды — true для 10-10…10-15, false для 10-16', async () => {
    const a = await absence();
    const o = [period('2026-10-10', '2026-10-13', 'a'), period('2026-10-12', '2026-10-15', 'b')];
    for (const d of ['10', '11', '12', '13', '14', '15']) expect(a.isAbsenceDay(`2026-10-${d}`, o), d).toBe(true);
    expect(a.isAbsenceDay('2026-10-16', o)).toBe(false);
  });
});

describe('T-012 Д4: autoWriteoffsForDay пропускает дни отпуска', () => {
  const entries = [{ product: prod('milk', 'rhythmic', 20, 'г'), stateEvents: [] }];
  const ps = [period('2026-10-10', '2026-10-13')];

  it('T-012 Д4: 10-09 и 10-14 — по элементу (как T-010), 10-10…10-13 — []', async () => {
    const f = (await auto()).autoWriteoffsForDay;
    const got = ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'].map((d) => f(d, entries, DEFAULTS, ps).length);
    expect(got).toEqual([1, 0, 0, 0, 0, 1]);
    expect(nth(f('2026-10-09', entries, DEFAULTS, ps), 0)).toMatchObject({ productId: 'milk', quantity: 20, key: 'auto_writeoff:milk:2026-10-09' });
  });
});

describe('T-012 Д5: absenceCancels — что отменяется', () => {
  it('T-012 Д5: 8 автосписаний P и Q за 10-10…10-13 по возрастанию seq; прочее не попадает', async () => {
    const a = await absence();
    const events = baseJournal().reverse(); // порядок массива не равен порядку seq
    const r = a.absenceCancels(period('2026-10-10', '2026-10-13'), events, VILNIUS);
    const expected = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'].flatMap((d) => [[Q, d], [P, d]] as const);
    expect(r).toEqual(expected.map(([p, d]) => ({
      productId: p.id, targetId: autoId(p, d), key: `absence_cancel:${autoId(p, d)}`,
    })));
    expect(r).toHaveLength(8);
  });

  it('T-012 Д5: absenceCancelKey = absence_cancel:{targetId}', async () => {
    expect((await absence()).absenceCancelKey('abc-1')).toBe('absence_cancel:abc-1');
  });

  it('T-012 Д5: однодневный период и период без автосписаний', async () => {
    const a = await absence();
    expect(a.absenceCancels(period('2026-10-11', '2026-10-11'), baseJournal(), VILNIUS).map((x) => x.targetId))
      .toEqual([autoId(Q, '2026-10-11'), autoId(P, '2026-10-11')]);
    expect(a.absenceCancels(period('2027-01-01', '2027-01-05'), baseJournal(), VILNIUS)).toEqual([]);
    expect(a.absenceCancels(period('2026-10-10', '2026-10-13'), [], VILNIUS)).toEqual([]);
  });
});

describe('T-012 Д6: уже отменённые не отменяются повторно', () => {
  function journal() {
    const j = baseJournal();
    j.push(ev(P, 'c1', 300, 'cancel', '2026-10-15T06:00:00.000Z', { targetId: autoId(P, '2026-10-10'), source: 'user' }));
    j.push(ev(P, 'c2', 301, 'cancel', '2026-10-15T06:00:00.000Z', { targetId: autoId(P, '2026-10-11'), source: 'user' }));
    j.push(ev(P, 'c3', 302, 'cancel', '2026-10-15T06:01:00.000Z', { targetId: 'c2', source: 'user' }));
    j.push(ev(Q, 'old-abs', 303, 'cancel', '2026-10-14T06:00:00.000Z',
      { targetId: autoId(Q, '2026-10-12'), source: 'absence' }));
    j.push(ev(Q, 'ghost', 304, 'cancel', '2026-10-15T06:00:00.000Z', { targetId: 'no-such-event', source: 'user' }));
    return j;
  }

  it('T-012 Д6: нет P/10-10 и Q/10-12, есть P/10-11 (отмена отменена); всего 6', async () => {
    const r = (await absence()).absenceCancels(period('2026-10-10', '2026-10-13'), journal(), VILNIUS);
    const t = r.map((x) => x.targetId);
    expect(t).not.toContain(autoId(P, '2026-10-10'));
    expect(t).not.toContain(autoId(Q, '2026-10-12'));
    expect(t).toContain(autoId(P, '2026-10-11'));
    expect(r).toHaveLength(6);
  });

  it('T-012 Д6: висячая ссылка и сами отмены в результат не попадают и на него не влияют', async () => {
    const a = await absence();
    const withGhost = a.absenceCancels(period('2026-10-10', '2026-10-13'), journal(), VILNIUS);
    const without = a.absenceCancels(period('2026-10-10', '2026-10-13'), journal().filter((e) => e.id !== 'ghost'), VILNIUS);
    expect(withGhost).toEqual(without);
    expect(cancelledIds(journal()).has('no-such-event')).toBe(true); // контроль: висячая ссылка в наборе есть
  });
});

describe('T-012 Д7: сутки перехода времени (BR-27)', () => {
  const days = ['2026-03-28', '2026-03-29', '2026-03-30', '2026-10-24', '2026-10-25', '2026-10-26'];
  const events = days.map((d, i) => autoEv(P, 10 + i, d));

  it.each(['2026-03-29', '2026-10-25'])('T-012 Д7: период из одних суток %s — ровно автосписание этих суток', async (d) => {
    const r = (await absence()).absenceCancels(period(d, d), events, VILNIUS);
    expect(nth(events, days.indexOf(d)).occurredAt).toBe(d === '2026-03-29' ? '2026-03-28T22:00:00.000Z' : '2026-10-24T21:00:00.000Z');
    expect(r.map((x) => x.targetId)).toEqual([autoId(P, d)]);
  });
});

describe('T-012 Д8: чистота', () => {
  it('T-012 Д8: повтор вызовов даёт равный результат, Date.now не влияет, входы не меняются', async () => {
    const a = await absence();
    const events = deepFreeze(baseJournal());
    const p = deepFreeze(period('2026-10-10', '2026-10-13'));
    const ps = deepFreeze([period('2026-10-10', '2026-10-13')]);
    const input = deepFreeze({ id: 'x', start: '2026-10-10', end: '2026-10-13', recordedAt: REC });
    const r1 = a.absenceCancels(p, events, VILNIUS);
    const d1 = a.isAbsenceDay('2026-10-11', ps);
    const c1 = a.createAbsencePeriod(input);
    vi.spyOn(Date, 'now').mockReturnValue(0);
    expect(a.absenceCancels(p, events, VILNIUS)).toEqual(r1);
    expect(a.isAbsenceDay('2026-10-11', ps)).toBe(d1);
    expect(a.createAbsencePeriod(input)).toEqual(c1);
    expect(events).toEqual(baseJournal());
  });
});
