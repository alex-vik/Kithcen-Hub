// Общие данные тестов каталога (T-001). Время фиксировано и передаётся явно (ADR-004, 14.4).

export const T_CREATE = Temporal.Instant.from('2026-10-06T10:00:00Z');
export const T_EDIT = Temporal.Instant.from('2026-10-07T08:00:00Z');

// «Позиция кофе» из раздела «Критерии приёмки» T-001 + порция 10 (К1).
export const coffee = {
  name: 'Кофе в зёрнах',
  category: 'Напитки',
  writeOffType: 'ритмичный',
  consumptionUnit: 'г',
  packageName: 'пачка',
  packageFactor: 250,
  norm: 20,
  lowStockThreshold: null as number | null,
  portion: 10,
};
