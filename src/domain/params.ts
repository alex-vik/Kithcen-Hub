// Параметры домена (ADR-004, «Каталоги»). T-001, раздел 15 спеки.
export type Params = {
  suggestedPortionShare: number;
  consumptionUnits: readonly string[];
  productCategories: readonly string[];
};

// Раздел 15 спеки: значения по умолчанию.
export const defaultParams: Params = {
  suggestedPortionShare: 1.0,
  consumptionUnits: ['г', 'мл', 'шт'],
  productCategories: [
    'Молочное и яйца', 'Мясо и рыба', 'Овощи и фрукты', 'Хлеб и выпечка', 'Крупы и макароны',
    'Консервы и соусы', 'Специи и бакалея', 'Заморозка', 'Напитки', 'Сладкое и снеки', 'Бытовое', 'Другое',
  ],
};
