// T-001, К25–К29: ручная правка. FR-CAT-02, BR-10.
// Семантика (решение delivery-lead): непереданное поле не меняется, null сбрасывает;
// частичная правка сохраняет вторую половину пары; результат проверяется по правилам создания.
import { describe, expect, it } from 'vitest';
import { editProduct, type ProductPatch } from '../../src/domain/catalog.ts';
import { DAY, WEEK, coffee, days, errorOf, norm, product, value } from '../support/products.ts';

describe('T-001 К25: каждый атрибут правится отдельно', () => {
  const cases: [string, ProductPatch, object][] = [
    ['название', { name: 'Кофе зерновой' }, { name: 'Кофе зерновой' }],
    ['категория', { category: 'Чай' }, { category: 'Чай' }],
    ['тип списания', { writeOffType: 'sporadic' }, { writeOffType: 'sporadic' }],
    ['расходная единица', { unit: 'мл' }, { unit: 'мл' }],
    [
      'упаковка с коэффициентом',
      { packName: 'коробка', packSize: 500 },
      { pack: { name: 'коробка', sizeMilli: 500000 } },
    ],
    [
      'норма с периодом',
      { normAmount: 250, normPeriod: WEEK },
      { norm: norm(35714, 250000, WEEK) },
    ],
    ['нижний порог', { lowThreshold: 200 }, { lowThresholdMilli: 200000 }],
    ['порция', { portion: 20 }, { portionMilli: 20000 }],
  ];

  it.each(cases)('T-001 К25: %s', (_name, patch, changed) => {
    const result = value(editProduct(coffee(), patch));
    expect(result).toEqual({ ...coffee(), ...changed });
    expect(result.active).toBe(true);
  });

  it('T-001 К25: только normAmount — период сохраняется', () => {
    const p = value(editProduct(coffee(), { normAmount: 60 }));
    expect(p.norm).toEqual(norm(60000, 60000, DAY));
  });

  it('T-001 К25: только normAmount при недельном периоде — пересчёт по сохранённому периоду', () => {
    const base = product({ norm: norm(35714, 250000, WEEK) });
    expect(value(editProduct(base, { normAmount: 700 })).norm).toEqual(norm(100000, 700000, WEEK));
  });

  it('T-001 К25: только период — количество сохраняется', () => {
    const p = value(editProduct(coffee(), { normPeriod: days(2) }));
    expect(p.norm).toEqual(norm(15000, 30000, days(2)));
  });

  it('T-001 К25: только packSize — название упаковки сохраняется', () => {
    const p = value(editProduct(coffee(), { packSize: 500 }));
    expect(p.pack).toEqual({ name: 'пачка', sizeMilli: 500000 });
  });

  it('T-001 К25: только packName — коэффициент сохраняется', () => {
    const p = value(editProduct(coffee(), { packName: 'банка' }));
    expect(p.pack).toEqual({ name: 'банка', sizeMilli: 250000 });
  });

  it('T-001 К25: пустой патч ничего не меняет', () => {
    expect(value(editProduct(coffee(), {}))).toEqual(coffee());
  });
});

describe('T-001 К26: сброс необязательных атрибутов', () => {
  it('T-001 К26: норма вместе с периодом', () => {
    const p = value(editProduct(coffee(), { normAmount: null, normPeriod: null }));
    expect(p).toEqual({ ...coffee(), norm: null });
  });

  it.each([
    ['нижний порог', { lowThreshold: null }, { lowThresholdMilli: null }],
    ['порция', { portion: null }, { portionMilli: null }],
    ['категория', { category: null }, { category: null }],
    ['тип списания', { writeOffType: null }, { writeOffType: null }],
    ['упаковка вместе с коэффициентом', { packName: null, packSize: null }, { pack: null }],
  ] as [string, ProductPatch, object][])('T-001 К26: %s', (_name, patch, changed) => {
    expect(value(editProduct(coffee(), patch))).toEqual({ ...coffee(), ...changed });
  });
});

describe('T-001 К27: неуспешная правка ничего не меняет', () => {
  const bad: [string, ProductPatch, string][] = [
    ['единица «пачка»', { unit: 'пачка' }, 'unit'],
    ['единица null', { unit: null }, 'unit'],
    ['пустое название', { name: '' }, 'name'],
    ['название из пробелов', { name: '   ' }, 'name'],
    ['упаковка без коэффициента', { packName: 'коробка', packSize: null }, 'pack'],
    ['коэффициент без упаковки', { packName: null, packSize: 250 }, 'pack'],
    ['коэффициент 0', { packSize: 0 }, 'pack_size'],
    ['коэффициент −1', { packSize: -1 }, 'pack_size'],
    ['норма 0', { normAmount: 0 }, 'norm'],
    ['порция 0', { portion: 0 }, 'portion'],
    ['нижний порог −1', { lowThreshold: -1 }, 'low_threshold'],
    ['норма без периода', { normAmount: 250, normPeriod: null }, 'norm_period'],
    ['N дней = 0', { normPeriod: days(0) }, 'norm_period'],
    ['N дней = −1', { normPeriod: days(-1) }, 'norm_period'],
    ['N дней = 1,5', { normPeriod: days(1.5) }, 'norm_period'],
    ['суточная норма округлилась до 0', { normAmount: 0.001, normPeriod: WEEK }, 'norm'],
  ];

  it.each(bad)('T-001 К27: %s — отказ, позиция не изменена', (_name, patch, code) => {
    const original = coffee();
    const snapshot = structuredClone(original);
    expect(errorOf(editProduct(original, patch))).toBe(code);
    expect(original).toEqual(snapshot);
  });
});

describe('T-001 К28: правка не выставляет норму (BR-10)', () => {
  it('T-001 К28: название, порция и коэффициент — норма пуста', () => {
    const base = product({ pack: { name: 'пачка', sizeMilli: 250000 } });
    for (const patch of [{ name: 'Новое' }, { portion: 15 }, { packSize: 500 }] as ProductPatch[]) {
      expect(value(editProduct(base, patch)).norm).toBeNull();
    }
  });
});

describe('T-001 К29: активность не меняется общей правкой', () => {
  it('T-001 К29: любая правка из К25 оставляет позицию активной', () => {
    const patches: ProductPatch[] = [
      { name: 'Н' },
      { category: 'Ч' },
      { writeOffType: 'slow' },
      { unit: 'мл' },
      { packName: 'к', packSize: 500 },
      { normAmount: 250, normPeriod: WEEK },
      { lowThreshold: 200 },
      { portion: 20 },
    ];
    for (const patch of patches) {
      expect(value(editProduct(coffee(), patch)).active).toBe(true);
    }
  });

  it('T-001 К29: поле active в патче игнорируется', () => {
    const patch = { active: false } as unknown as ProductPatch;
    expect(value(editProduct(coffee(), patch)).active).toBe(true);
  });
});
