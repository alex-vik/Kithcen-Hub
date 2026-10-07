// T-008 К16, К17 на уменьшенном журнале (общий набор, без времени). Полный объём и К18 — npm run perf.
import { describe, expect, it } from 'vitest';
import { checkDeterminism, checkDomainEqualsStorage, checkJournalShape } from './checks.ts';
import { PERF } from './config.ts';
import { generateJournal } from './journal.ts';

describe('T-008 синтетический журнал, уменьшенный объём', () => {
  const journal = generateJournal(PERF.seed, PERF.reducedEvents);

  it('T-008 К16: 200 позиций, 60 ритмичных, объём ±1%, ≤5000 на позицию, все виды событий и отмена отмены', () => {
    checkJournalShape(journal, PERF.reducedEvents);
  });

  it('T-008 К16: тот же сид даёт тот же журнал, другой — иной', () => {
    checkDeterminism(PERF.reducedEvents);
  });

  it('T-008 К17: остатки всех позиций в памяти и через хранилище совпадают', () => {
    checkDomainEqualsStorage(journal);
    expect(journal.events.length).toBeGreaterThan(0);
  });
});
