// T-001: позиция каталога (FR-CAT-01, FR-CAT-02, FR-CAT-08, BR-03, BR-04, BR-05, BR-08, BR-10).
// Имя теста начинается с T-001 и номера критерия (К1…К20).
// Интерфейс модуля src/domain/catalog.ts задан этими тестами; см. отчёт tester.
import { describe, expect, it } from 'vitest';
import {
  changeUnit,
  createProduct,
  isActive,
  packsToUnits,
  suggestPortion,
  updateProduct,
} from '../../src/domain/catalog.ts';
import type { Product, ProductInput, StateEvent } from '../../src/domain/catalog.ts';

const full: ProductInput = {
  id: 'p-buckwheat',
  name: 'Гречка',
  category: 'Крупы',
  writeOffType: 'burst',
  unit: 'г',
  packName: 'пачка',
  unitsPerPack: 900,
  norm: 30,
  lowThreshold: 300,
  portion: 80,
};

const minimal: ProductInput = {
  id: 'p-min',
  name: 'Соль',
  unit: 'г',
  packName: 'пачка',
  unitsPerPack: 1000,
};

const cfg1 = { portionsPerDailyNorm: 1 };

/** Достаёт позицию из результата; падает с понятным сообщением, если результат — ошибка. */
function ok(r: { ok: boolean }): Product {
  const res = r as { ok: true; value: Product } | { ok: false; error: { attribute: string } };
  if (!res.ok) throw new Error(`ожидалась позиция, получена ошибка по «${res.error.attribute}»`);
  return res.value;
}

function make(input: ProductInput = full): Product {
  return ok(createProduct(input));
}

/** Поверхностная заморозка (Object.freeze): присваивание в поле позиции в строгом режиме бросит исключение; позиция плоская, вложенных объектов нет. */
function frozen(input: ProductInput = full): Product {
  const p = make(input);
  return Object.freeze({ ...p });
}

// Недопустимые значения из К4: [описание, атрибут, патч/поля].
const invalidCases: Array<[string, string, Record<string, unknown>]> = [
  ['пустое название', 'name', { name: '' }],
  ['пустая торговая упаковка', 'packName', { packName: '' }],
  ['торговая упаковка из пробелов', 'packName', { packName: '   ' }],
  ['коэффициент 0', 'unitsPerPack', { unitsPerPack: 0 }],
  ['коэффициент -1', 'unitsPerPack', { unitsPerPack: -1 }],
  ['коэффициент NaN', 'unitsPerPack', { unitsPerPack: Number.NaN }],
  ['коэффициент Infinity', 'unitsPerPack', { unitsPerPack: Number.POSITIVE_INFINITY }],
  ['норма 0', 'norm', { norm: 0 }],
  ['норма -5', 'norm', { norm: -5 }],
  ['порог -1', 'lowThreshold', { lowThreshold: -1 }],
  ['порция 0', 'portion', { portion: 0 }],
];

describe('T-001 К1: позиция со всеми атрибутами', () => {
  it('T-001 К1: все атрибуты равны переданным, величины — числа', () => {
    const p = make();
    expect(p.id).toBe('p-buckwheat');
    expect(p.name).toBe('Гречка');
    expect(p.category).toBe('Крупы');
    expect(p.writeOffType).toBe('burst');
    expect(p.unit).toBe('г');
    expect(p.packName).toBe('пачка');
    expect(p.unitsPerPack).toBe(900);
    expect(p.norm).toBe(30);
    expect(p.lowThreshold).toBe(300);
    expect(p.portion).toBe(80);
    expect(typeof p.norm).toBe('number');
    expect(typeof p.lowThreshold).toBe('number');
    expect(typeof p.portion).toBe('number');
  });
});

describe('T-001 К2: минимальный набор атрибутов', () => {
  it('T-001 К2: норма, порог, порция и категория пусты, тип «не задан»', () => {
    const p = make(minimal);
    expect(p.norm).toBeNull();
    expect(p.lowThreshold).toBeNull();
    expect(p.portion).toBeNull();
    expect(p.category).toBeNull();
    expect(p.writeOffType).toBe('unset');
    expect(p.name).toBe('Соль');
    expect(p.unit).toBe('г');
    expect(p.packName).toBe('пачка');
    expect(p.unitsPerPack).toBe(1000);
  });
});

describe('T-001 К3: норма не заполняется системой (BR-10)', () => {
  it('T-001 К3: без нормы, но с порцией 10, норма пуста после создания и после предложения порции', () => {
    const p = make({ ...minimal, portion: 10 });
    expect(p.norm).toBeNull();
    suggestPortion(p, cfg1);
    expect(p.norm).toBeNull();
    expect(p.portion).toBe(10);
  });
});

describe('T-001 К4: недопустимые значения при создании', () => {
  it.each(invalidCases)('T-001 К4: %s отклоняется с указанием атрибута', (_d, attribute, bad) => {
    const r = createProduct({ ...full, ...bad } as ProductInput);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.attribute).toBe(attribute);
  });

  it('T-001 К4: единица не из списка отклоняется с указанием атрибута', () => {
    const r = createProduct({ ...full, unit: 'кг' } as unknown as ProductInput);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.attribute).toBe('unit');
  });

  it('T-001 К4: исключение не выбрасывается', () => {
    for (const [, , bad] of invalidCases) {
      expect(() => createProduct({ ...full, ...bad } as ProductInput)).not.toThrow();
    }
    expect(() => createProduct({ ...full, unit: 'кг' } as unknown as ProductInput)).not.toThrow();
  });

  it('T-001 К4: закрытый список единиц — г, мл, шт принимаются', () => {
    for (const unit of ['г', 'мл', 'шт'] as const) {
      expect(make({ ...full, unit }).unit).toBe(unit);
    }
  });
});

describe('T-001 К5: граничные допустимые значения', () => {
  it('T-001 К5: коэффициент 0,5 и нижний порог 0 допустимы', () => {
    const p = make({ ...full, unitsPerPack: 0.5, lowThreshold: 0 });
    expect(p.unitsPerPack).toBe(0.5);
    expect(p.lowThreshold).toBe(0);
  });
});

describe('T-001 К6: правка любого атрибута', () => {
  const patches: Array<[string, Record<string, unknown>]> = [
    ['name', { name: 'Гречка ядрица' }],
    ['category', { category: 'Бакалея' }],
    ['writeOffType', { writeOffType: 'rhythmic' }],
    ['packName', { packName: 'мешок' }],
    ['unitsPerPack', { unitsPerPack: 800 }],
    ['norm', { norm: 45 }],
    ['lowThreshold', { lowThreshold: 150 }],
    ['portion', { portion: 100 }],
  ];

  it.each(patches)('T-001 К6: правка «%s» меняет только его, исходный объект цел', (attr, patch) => {
    const original = frozen();
    const snapshot = structuredClone(original);
    const updated = ok(updateProduct(original, patch));
    expect(original).toEqual(snapshot);
    expect(updated).toEqual({ ...snapshot, ...patch });
    expect((updated as Record<string, unknown>)[attr]).toBe(patch[attr]);
  });
});

describe('T-001 К7: очистка нормы, порога и порции', () => {
  it.each(['norm', 'lowThreshold', 'portion'] as const)('T-001 К7: «%s» очищается без ошибки', (attr) => {
    const r = updateProduct(make(), { [attr]: null });
    expect(r.ok).toBe(true);
    expect(ok(r)[attr]).toBeNull();
  });
});

describe('T-001 К8: правка коэффициента не пересчитывает величины', () => {
  it('T-001 К8: коэффициент 900 → 800, норма 30, порог 300, порция 80', () => {
    const p = ok(updateProduct(make(), { unitsPerPack: 800 }));
    expect(p.unitsPerPack).toBe(800);
    expect(p.norm).toBe(30);
    expect(p.lowThreshold).toBe(300);
    expect(p.portion).toBe(80);
  });
});

describe('T-001 К8а: правка недопустимым значением', () => {
  it.each(invalidCases)('T-001 К8а: %s — ошибка с атрибутом, позиция не изменилась', (_d, attribute, bad) => {
    const original = frozen();
    const snapshot = structuredClone(original);
    const r = updateProduct(original, bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.attribute).toBe(attribute);
    expect(original).toEqual(snapshot);
  });

  it('T-001 К8а: исключение не выбрасывается', () => {
    for (const [, , bad] of invalidCases) {
      expect(() => updateProduct(make(), bad)).not.toThrow();
    }
  });

  it('T-001 К8а: единица не из списка — ошибка по unit, позиция не изменилась', () => {
    const original = frozen();
    const snapshot = structuredClone(original);
    const r = changeUnit(original, 'кг' as unknown as 'г', false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.attribute).toBe('unit');
    expect(original).toEqual(snapshot);
  });
});

describe('T-001 К9: смена единицы без событий остатка', () => {
  it('T-001 К9: «г» → «шт», остальное не изменилось', () => {
    const original = frozen();
    const snapshot = structuredClone(original);
    const p = ok(changeUnit(original, 'шт', false));
    expect(p).toEqual({ ...snapshot, unit: 'шт' });
    expect(original).toEqual(snapshot);
  });
});

describe('T-001 К10: смена единицы с событиями остатка', () => {
  it('T-001 К10: ошибка по unit с признаком истории, позиция не изменилась', () => {
    const original = frozen();
    const snapshot = structuredClone(original);
    const r = changeUnit(original, 'шт', true);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.attribute).toBe('unit');
      expect(r.error.code).toBe('has_history');
      expect(r.error.message).toContain('у позиции есть история — создайте новую позицию');
    }
    expect(original).toEqual(snapshot);
  });
});

describe('T-001 К10а: разные единицы — разные позиции', () => {
  it('T-001 К10а: правки одной позиции не затрагивают другую', () => {
    const ground = make({ id: 'c1', name: 'Кофе молотый', unit: 'г', packName: 'пачка', unitsPerPack: 250, norm: 20 });
    const caps = make({ id: 'c2', name: 'Кофе в капсулах', unit: 'шт', packName: 'коробка', unitsPerPack: 10, norm: 2 });
    const capsSnapshot = structuredClone(caps);
    const edited = ok(updateProduct(ground, { norm: 25, lowThreshold: 50, portion: 20, unitsPerPack: 500 }));
    expect(caps).toEqual(capsSnapshot);
    expect(edited.unit).toBe('г');
    expect(caps.unit).toBe('шт');
    expect(edited.id).not.toBe(caps.id);
  });
});

describe('T-001 К11: предложение порции из нормы', () => {
  it('T-001 К11: порций в суточной норме 1 → 20, 2 → 10', () => {
    const p = make({ ...minimal, norm: 20 });
    expect(suggestPortion(p, { portionsPerDailyNorm: 1 })).toBe(20);
    expect(suggestPortion(p, { portionsPerDailyNorm: 2 })).toBe(10);
  });
});

describe('T-001 К12: без нормы предложения нет', () => {
  it('T-001 К12: результат null — не 0 и не ошибка', () => {
    const p = make(minimal);
    expect(() => suggestPortion(p, cfg1)).not.toThrow();
    expect(suggestPortion(p, cfg1)).toBeNull();
  });
});

describe('T-001 К13: предложение не меняет позицию', () => {
  it('T-001 К13: ручная порция 15 сохраняется после правки нормы, предложение — отдельное значение', () => {
    const original = frozen({ ...minimal, norm: 20, portion: 15 });
    expect(suggestPortion(original, cfg1)).toBe(20);
    expect(original.portion).toBe(15);
    const edited = ok(updateProduct(original, { norm: 40 }));
    expect(edited.portion).toBe(15);
    expect(suggestPortion(edited, cfg1)).toBe(40);
    expect(edited.portion).toBe(15);
  });
});

describe('T-001 К14: упаковки в расходные единицы', () => {
  it('T-001 К14: 2 упаковки по 900 → 1800', () => {
    expect(packsToUnits(make(), 2)).toBe(1800);
  });
});

describe('T-001 К15: другой размер упаковки — та же позиция', () => {
  it('T-001 К15: 1 упаковка с явным коэффициентом 500 → 500, коэффициент позиции 1000', () => {
    const milk = make({ id: 'p-milk', name: 'Молоко', unit: 'мл', packName: 'бутылка', unitsPerPack: 1000 });
    expect(packsToUnits(milk, 1, 500)).toBe(500);
    expect(milk.unitsPerPack).toBe(1000);
    expect(packsToUnits(milk, 1)).toBe(1000);
  });
});

function ev(
  id: string,
  seq: number,
  occurredAt: string,
  state: 'active' | 'inactive',
  reason: StateEvent['reason'],
): StateEvent {
  // T-004 К32: recordedAt обязателен; он идёт против seq (больший seq — более раннее recordedAt),
  // чтобы реализация, ошибочно решающая по recordedAt, ломала К18/К19.
  const recordedAt = `2026-10-20T00:00:${String(59 - seq).padStart(2, '0')}.000Z`;
  return { id, seq, productId: 'p-buckwheat', occurredAt, recordedAt, state, reason };
}

describe('T-001 К16: нет событий состояния', () => {
  it('T-001 К16: пустой журнал — активна', () => {
    expect(isActive([])).toBe(true);
  });
});

describe('T-001 К17: одно состояние «неактивна» при любом поводе', () => {
  it('T-001 К17: user_button и auto_archive дают одинаковый результат — неактивна', () => {
    const byButton = isActive([ev('e1', 1, '2026-10-10T09:00:00.000Z', 'inactive', 'user_button')]);
    const byArchive = isActive([ev('e2', 1, '2026-10-10T09:00:00.000Z', 'inactive', 'auto_archive')]);
    expect(byButton).toBe(false);
    expect(byArchive).toBe(false);
    expect(byButton).toBe(byArchive);
  });

  it('T-001 К17: функция возвращает только boolean', () => {
    expect(typeof isActive([])).toBe('boolean');
    expect(typeof isActive([ev('e1', 1, '2026-10-10T09:00:00.000Z', 'inactive', 'auto_archive')])).toBe('boolean');
  });
});

describe('T-001 К18: решает последнее событие по времени, а не по порядку в массиве', () => {
  it('T-001 К18: перемешанный порядок — активна', () => {
    const events = [
      ev('e1', 1, '2026-10-10T09:00:00.000Z', 'inactive', 'user_button'),
      ev('e3', 3, '2026-10-12T18:00:00.000Z', 'active', 'purchase'),
      ev('e2', 2, '2026-10-11T12:00:00.000Z', 'inactive', 'user_button'),
    ];
    expect(isActive(events)).toBe(true);
  });

  it('T-001 К18: больший seq, но более раннее время (задним числом) — решает время, неактивна', () => {
    const events = [
      ev('e5', 5, '2026-10-12T12:00:00.000Z', 'inactive', 'user_button'),
      ev('e6', 6, '2026-10-12T10:00:00.000Z', 'active', 'purchase'),
    ];
    expect(isActive(events)).toBe(false);
    expect(isActive([...events].reverse())).toBe(false);
  });

  it('T-001 К18: больший seq, но более раннее время — зеркально, активна', () => {
    const events = [
      ev('e5', 5, '2026-10-12T12:00:00.000Z', 'active', 'user_restore'),
      ev('e6', 6, '2026-10-12T10:00:00.000Z', 'inactive', 'auto_archive'),
    ];
    expect(isActive(events)).toBe(true);
    expect(isActive([...events].reverse())).toBe(true);
  });

  it('T-001 К18: вход не мутируется (порядок массива сохраняется)', () => {
    const events = [
      ev('e1', 1, '2026-10-10T09:00:00.000Z', 'inactive', 'user_button'),
      ev('e3', 3, '2026-10-12T18:00:00.000Z', 'active', 'purchase'),
      ev('e2', 2, '2026-10-11T12:00:00.000Z', 'inactive', 'user_button'),
    ];
    const ids = events.map((e) => e.id);
    isActive(events);
    expect(events.map((e) => e.id)).toEqual(ids);
  });
});

describe('T-001 К19: при совпадении времени решает seq', () => {
  const t = '2026-10-12T18:00:00.000Z';

  it('T-001 К19: у inactive seq больше — неактивна', () => {
    expect(isActive([ev('a', 1, t, 'active', 'purchase'), ev('b', 2, t, 'inactive', 'user_button')])).toBe(false);
  });

  it('T-001 К19: у active seq больше — активна', () => {
    expect(isActive([ev('a', 2, t, 'active', 'purchase'), ev('b', 1, t, 'inactive', 'user_button')])).toBe(true);
  });
});

describe('T-001 К20: параметры — из конфигурации', () => {
  it('T-001 К20: результат зависит только от переданного объекта конфигурации', () => {
    const p = make({ ...minimal, norm: 30 });
    expect(suggestPortion(p, { portionsPerDailyNorm: 3 })).toBe(10);
    expect(suggestPortion(p, { portionsPerDailyNorm: 0.5 })).toBe(60);
    expect(suggestPortion(p, { portionsPerDailyNorm: 4 })).toBe(7.5);
  });
});

describe('T-004 К32: у события состояния есть recordedAt и необязательная refEventId', () => {
  const t = '2026-10-12T18:00:00.000Z';

  it('T-004 К32: форма типа — recordedAt обязателен, refEventId необязательна (проверяет npm run typecheck)', () => {
    const shape = (): StateEvent[] => {
      const withRef: StateEvent = { ...ev('a', 1, t, 'active', 'purchase'), refEventId: 'e-1' };
      const withoutRef: StateEvent = ev('b', 2, t, 'inactive', 'user_button');
      // @ts-expect-error recordedAt обязателен
      const noRecordedAt: StateEvent = { id: 'c', seq: 3, productId: 'p', occurredAt: t, state: 'active', reason: 'purchase' };
      return [withRef, withoutRef, noRecordedAt];
    };
    expect(typeof shape).toBe('function');
    expect(ev('a', 1, t, 'active', 'purchase').recordedAt).toMatch(/^2026-10-20T/);
  });

  it('T-004 К32: refEventId и recordedAt на активность не влияют', () => {
    const a = { ...ev('a', 1, t, 'inactive', 'user_button'), refEventId: 'e-1' };
    const b = { ...ev('b', 2, t, 'active', 'purchase'), refEventId: 'e-2', recordedAt: '2026-01-01T00:00:00.000Z' };
    expect(isActive([a, b])).toBe(true);
    expect(isActive([b, a])).toBe(true);
    expect(isActive([{ ...a, recordedAt: '2030-01-01T00:00:00.000Z' }])).toBe(false);
  });
});
