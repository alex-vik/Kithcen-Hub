// T-006 К1: ВРЕМЕННЫЙ профиль дома. Список продуктов сгенерирован по поручению владельца 2026-10-06 (Q-19)
// и ждёт проверки здравым смыслом; заменяется реальным списком, когда владелец его даст.
// Метрики на нём — предварительные.
import type { ProductInput } from '../../src/domain/catalog.ts';

export type Consumer = 'people' | 'dog';

/** Параметры реального расхода своего типа (в расходных единицах). */
export type Usage =
  | { kind: 'rhythmic'; dailyUnits: number; slotHours: readonly number[] }
  | { kind: 'burst'; usesPerWeek: number; unitsPerUse: number }
  | { kind: 'slow'; packLifeDays: number };

export type SimProduct = {
  /** Вход createProduct. Нормы нет: систему к ней приводит калибровка (BR-10); реальный расход — в usage. */
  input: ProductInput;
  usage: Usage;
  consumers: readonly Consumer[];
};

export type HomeProfile = {
  temporary: boolean;
  /** Ссылка на вопрос, по которому профиль временный. */
  source: string;
  household: { adults: number; dog: { ageYears: number; weightKg: number } };
  /** Календарь Q-19: только данные, в генераторе реальности до B-05 не участвует (НВ-3). */
  calendar: {
    guests: { fourPeoplePerMonth: number; sixPeoplePerMonths: number; multiDayShare: number };
    trips: { shortPerYear: number; shortDays: readonly [number, number]; vacationPerYear: number; vacationDays: number };
  };
  products: readonly SimProduct[];
};

const P = (
  id: string, name: string, unit: 'г' | 'мл' | 'шт', packName: string, unitsPerPack: number,
  usage: Usage, consumers: readonly Consumer[] = ['people'],
): SimProduct => ({
  input: { id, name, unit, packName, unitsPerPack, writeOffType: usage.kind },
  usage,
  consumers,
});

const R = (dailyUnits: number, ...slotHours: number[]): Usage => ({ kind: 'rhythmic', dailyUnits, slotHours });
const B = (usesPerWeek: number, unitsPerUse: number): Usage => ({ kind: 'burst', usesPerWeek, unitsPerUse });
const S = (packLifeDays: number): Usage => ({ kind: 'slow', packLifeDays });

export const TEMP_PROFILE: HomeProfile = {
  temporary: true,
  source: 'Q-19 (решение владельца 2026-10-06: список продуктов генерируется временно)',
  household: { adults: 2, dog: { ageYears: 8, weightKg: 6 } },
  calendar: {
    guests: { fourPeoplePerMonth: 1, sixPeoplePerMonths: 3, multiDayShare: 0.25 },
    trips: { shortPerYear: 2, shortDays: [3, 4], vacationPerYear: 1, vacationDays: 14 },
  },
  products: [
    // ритмичные
    P('dog-food', 'Корм для собак (сухой)', 'г', 'пакет 2 кг', 2000, R(40, 8, 19), ['dog']),
    P('milk', 'Молоко 2.5%', 'мл', 'пакет 1 л', 1000, R(400, 8, 16)),
    P('bread', 'Хлеб ржаной', 'г', 'буханка 500 г', 500, R(200, 8, 19)),
    P('coffee', 'Кофе молотый', 'г', 'пачка 250 г', 250, R(36, 8, 14)),
    P('tea-bags', 'Чай чёрный в пакетиках', 'шт', 'коробка 100 шт', 100, R(4, 10, 16, 20)),
    P('butter', 'Масло сливочное', 'г', 'пачка 200 г', 200, R(20, 8)),
    P('sugar', 'Сахар', 'г', 'пакет 1 кг', 1000, R(25, 8, 15)),
    // рывковые
    P('rice', 'Рис круглозёрный', 'г', 'пакет 1 кг', 1000, B(1.5, 150)),
    P('buckwheat', 'Гречка', 'г', 'пакет 800 г', 800, B(1, 200)),
    P('pasta', 'Макароны', 'г', 'пачка 500 г', 500, B(2, 125)),
    P('eggs', 'Яйца', 'шт', 'десяток', 10, B(3, 3)),
    P('chicken', 'Куриное филе', 'г', 'лоток 800 г', 800, B(1.5, 400)),
    P('cheese', 'Сыр твёрдый', 'г', 'кусок 300 г', 300, B(2, 100)),
    P('oats', 'Овсяные хлопья', 'г', 'пачка 500 г', 500, B(2, 80)),
    P('tuna', 'Тунец консервированный', 'шт', 'банка', 1, B(1, 1)),
    P('potatoes', 'Картофель', 'г', 'сетка 2 кг', 2000, B(2, 600)),
    // медленные
    P('salt', 'Соль', 'г', 'пачка 1 кг', 1000, S(120)),
    P('oil', 'Масло оливковое', 'мл', 'бутылка 500 мл', 500, S(60)),
    P('flour', 'Мука пшеничная', 'г', 'пакет 1 кг', 1000, S(45)),
    P('pepper', 'Перец чёрный молотый', 'г', 'баночка 50 г', 50, S(180)),
    P('vinegar', 'Уксус яблочный', 'мл', 'бутылка 500 мл', 500, S(150)),
    P('soy-sauce', 'Соевый соус', 'мл', 'бутылка 250 мл', 250, S(90)),
    P('honey', 'Мёд', 'г', 'банка 400 г', 400, S(120)),
  ],
};
