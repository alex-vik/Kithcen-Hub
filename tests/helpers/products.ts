// Общие данные тестов каталога (T-001, переведены на T-003). Время фиксировано и передаётся явно (ADR-004, 14.4).

export const T_CREATE = Temporal.Instant.from('2026-10-06T10:00:00Z');
export const T_EDIT = Temporal.Instant.from('2026-10-07T08:00:00Z');

// «Молоко» из T-003: единица «бутылка», категория и минимум заданы.
export const milk = {
  name: 'Молоко',
  category: 'Молочное и яйца',
  unit: 'бутылка',
  minimum: 2 as number | null,
};
