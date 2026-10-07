// T-006 К2: сводка временного профиля для владельца.
import type { HomeProfile } from './profile.ts';

export type SummaryRow = {
  name: string;
  type: 'rhythmic' | 'burst' | 'slow';
  pack: { name: string; unitsPerPack: number };
  unit: string;
  weeklyUnits: number;
  weeklyPacks: number;
  /** Только для медленных. */
  packLifeDays: number | null;
  consumers: string;
};

export type ProfileSummary = { title: string; rows: SummaryRow[] };

const TYPE_RU = { rhythmic: 'ритмичный', burst: 'рывковый', slow: 'медленный' } as const;

export function summarizeProfile(profile: HomeProfile): ProfileSummary {
  const title =
    `${profile.temporary ? 'ВРЕМЕННЫЙ профиль' : 'Профиль'} дома: ${profile.household.adults} взрослых, ` +
    `собака ${profile.household.dog.weightKg} кг; основание: ${profile.source}`;
  const rows = profile.products.map((p): SummaryRow => {
    const u = p.usage;
    const perPack = p.input.unitsPerPack;
    const weeklyUnits =
      u.kind === 'rhythmic' ? u.dailyUnits * 7 : u.kind === 'burst' ? u.usesPerWeek * u.unitsPerUse : (perPack / u.packLifeDays) * 7;
    return {
      name: p.input.name,
      type: u.kind,
      pack: { name: p.input.packName, unitsPerPack: perPack },
      unit: p.input.unit,
      weeklyUnits,
      weeklyPacks: weeklyUnits / perPack,
      packLifeDays: u.kind === 'slow' ? u.packLifeDays : null,
      consumers: p.consumers.map((c) => (c === 'dog' ? 'собака' : 'люди')).join(', '),
    };
  });
  return { title, rows };
}

const fmt = (n: number): string => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));

/** Текстовая таблица (markdown) для отчёта. */
export function renderSummary(s: ProfileSummary): string {
  const head = '| Название | Тип | Упаковка | В неделю, ед. | В неделю, упак. | Срок упаковки, сут | Кто |\n| --- | --- | --- | ---: | ---: | ---: | --- |';
  const lines = s.rows.map(
    (r) =>
      `| ${r.name} | ${TYPE_RU[r.type]} | ${r.pack.name} (${r.pack.unitsPerPack} ${r.unit}) | ${fmt(r.weeklyUnits)} ${r.unit} | ${fmt(r.weeklyPacks)} | ${r.packLifeDays ?? '—'} | ${r.consumers} |`,
  );
  return `${s.title}\n\n${head}\n${lines.join('\n')}\n`;
}
