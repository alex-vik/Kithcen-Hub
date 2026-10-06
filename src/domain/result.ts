// ADR-004, разд. 4.3: отказ команды — значение, а не исключение.
// Исключение означает ошибку программы. Минус в остатке отказом не бывает (инвариант 6).
// Каркас для T-001 (B-01); файл стоит выше всех в карте ADR-004 4.2 и ничего не импортирует.

export type CommandResult<T, E extends string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
