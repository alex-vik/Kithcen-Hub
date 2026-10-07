// T-010 Д7–Д11: что и сколько списывается за сутки (FR-CON-01, BR-09, BR-10, BR-27).
import { describe, expect, it, vi, afterEach } from 'vitest';
import { nth } from '../server/storage/helpers.ts';
import { auto, DEFAULTS, prod, st } from './auto-helpers.ts';
import type { Entry } from './auto-helpers.ts';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const D = '2026-10-07';
const MILK = prod('milk', 'rhythmic', 250);
const one = (p = MILK): Entry[] => [{ product: p, stateEvents: [] }];

describe('T-010 Д7: ритмичная активная позиция с нормой', () => {
  it('T-010 Д7: один элемент — норма, ключ, occurredAt = 00:00 суток D по Вильнюсу в UTC', async () => {
    const a = await auto();
    expect(a.autoWriteoffsForDay(D, one(), DEFAULTS)).toEqual([
      { productId: 'milk', quantity: 250, key: 'auto_writeoff:milk:2026-10-07', occurredAt: '2026-10-06T21:00:00.000Z' },
    ]);
  });

  it('T-010 Д7: autoWriteoffKey = auto_writeoff:{productId}:{day}', async () => {
    const a = await auto();
    expect(a.autoWriteoffKey('abc', '2026-03-29')).toBe('auto_writeoff:abc:2026-03-29');
  });
});

describe('T-010 Д8: сутки перехода — одна норма', () => {
  it.each([
    ['2026-03-29', '2026-03-28T22:00:00.000Z'],
    ['2026-10-25', '2026-10-24T21:00:00.000Z'],
  ])('T-010 Д8: %s — один элемент, quantity 250 (не 23/24 и не 25/24 нормы), occurredAt %s', async (day, at) => {
    const a = await auto();
    const r = a.autoWriteoffsForDay(day, one(), DEFAULTS);
    expect(r).toHaveLength(1);
    expect(nth(r, 0).quantity).toBe(250);
    expect(nth(r, 0).occurredAt).toBe(at);
  });
});

describe('T-010 Д9: кого не списывать', () => {
  it('T-010 Д9: burst, slow, unset с нормой и rhythmic без нормы — ни одного элемента', async () => {
    const a = await auto();
    const entries: Entry[] = [
      { product: prod('b', 'burst', 100), stateEvents: [] },
      { product: prod('s', 'slow', 100), stateEvents: [] },
      { product: prod('u', 'unset', 100), stateEvents: [] },
      { product: prod('n', 'rhythmic', null), stateEvents: [] },
    ];
    expect(a.autoWriteoffsForDay(D, entries, DEFAULTS)).toEqual([]);
  });

  it('T-010 Д9: среди смешанных списываются только подходящие, порядок как в entries', async () => {
    const a = await auto();
    const entries: Entry[] = [
      { product: prod('b', 'burst', 100), stateEvents: [] },
      { product: prod('z', 'rhythmic', 3), stateEvents: [] },
      { product: prod('n', 'rhythmic', null), stateEvents: [] },
      { product: prod('a', 'rhythmic', 7), stateEvents: [] },
    ];
    expect(a.autoWriteoffsForDay(D, entries, DEFAULTS).map((x) => [x.productId, x.quantity])).toEqual([['z', 3], ['a', 7]]);
  });
});

describe('T-010 Д10: активность на конец суток D (НВ-2 а)', () => {
  // D = 2026-10-07: [2026-10-06T21:00Z, 2026-10-07T21:00Z)
  const mk = (id: string): ReturnType<typeof prod> => prod(id, 'rhythmic', 10);

  it('T-010 Д10: A, B — нет; C, E, F — есть', async () => {
    const a = await auto();
    const entries: Entry[] = [
      { product: mk('A'), stateEvents: [st('A', '2026-10-05T10:00:00.000Z', 'inactive')] },
      { product: mk('B'), stateEvents: [st('B', '2026-10-07T12:00:00.000Z', 'inactive')] }, // 15:00 местного
      { product: mk('C'), stateEvents: [
        st('C', '2026-10-05T10:00:00.000Z', 'inactive'),
        st('C', '2026-10-07T07:00:00.000Z', 'active', 'purchase'), // 10:00 местного
      ] },
      { product: mk('E'), stateEvents: [st('E', '2026-10-07T21:30:00.000Z', 'inactive')] }, // 00:30 суток D+1
      { product: mk('F'), stateEvents: [
        // порядок в массиве обратный: решает seq, а не позиция в массиве
        st('F', '2026-10-07T08:00:00.000Z', 'active', 'user_restore', 902),
        st('F', '2026-10-07T08:00:00.000Z', 'inactive', 'user_button', 901),
      ] },
    ];
    expect(a.autoWriteoffsForDay(D, entries, DEFAULTS).map((x) => x.productId)).toEqual(['C', 'E', 'F']);
  });

  it('T-010 Д10: граница — inactive ровно в конце суток D (21:00:00.000Z) уже относится к D+1', async () => {
    const a = await auto();
    const entries: Entry[] = [{ product: mk('G'), stateEvents: [st('G', '2026-10-07T21:00:00.000Z', 'inactive')] }];
    expect(a.autoWriteoffsForDay(D, entries, DEFAULTS).map((x) => x.productId)).toEqual(['G']);
  });

  it('T-010 Д10: inactive за миллисекунду до конца суток D — не списывается', async () => {
    const a = await auto();
    const entries: Entry[] = [{ product: mk('H'), stateEvents: [st('H', '2026-10-07T20:59:59.999Z', 'inactive')] }];
    expect(a.autoWriteoffsForDay(D, entries, DEFAULTS)).toEqual([]);
  });
});

describe('T-010 Д11: чистота и детерминизм', () => {
  const deepFreeze = <T,>(o: T): T => {
    if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
    return o;
  };

  it('T-010 Д11: два вызова равны; подмена Date.now и системного времени ничего не меняет', async () => {
    const a = await auto();
    const entries = [...one(), { product: prod('x', 'rhythmic', 5), stateEvents: [st('x', '2026-10-01T10:00:00.000Z', 'inactive'), st('x', '2026-10-02T10:00:00.000Z', 'active')] }];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
    const r1 = a.autoWriteoffsForDay(D, entries, DEFAULTS);
    vi.setSystemTime(new Date('2031-06-15T12:00:00.000Z'));
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const r2 = a.autoWriteoffsForDay(D, entries, DEFAULTS);
    expect(r2).toEqual(r1);
    expect(r1.map((x) => x.productId)).toEqual(['milk', 'x']);
  });

  it('T-010 Д11: входные данные не изменяются (глубоко замороженные аргументы, params)', async () => {
    const a = await auto();
    const entries = deepFreeze([
      { product: MILK, stateEvents: [st('milk', '2026-10-01T10:00:00.000Z', 'inactive'), st('milk', '2026-10-02T10:00:00.000Z', 'active')] },
    ]);
    const params = deepFreeze({ ...DEFAULTS });
    expect(() => a.autoWriteoffsForDay(D, entries, params)).not.toThrow();
    expect(a.autoWriteoffsForDay(D, entries, params)).toHaveLength(1);
  });

  it('T-010 Д11: пустой entries — пустой результат; результат — новый массив', async () => {
    const a = await auto();
    expect(a.autoWriteoffsForDay(D, [], DEFAULTS)).toEqual([]);
  });
});
