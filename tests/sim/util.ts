/** Элемент массива с проверкой (noUncheckedIndexedAccess). */
export function nth<T>(arr: readonly T[], i: number): T {
  const v = arr[i < 0 ? arr.length + i : i];
  if (v === undefined) throw new Error(`нет элемента ${i} в массиве длины ${arr.length}`);
  return v;
}
