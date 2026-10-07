// T-008 К16, К17 на уменьшенном журнале (общий набор, без времени). Полный объём и К18 — npm run perf.
import { describe, expect, it } from 'vitest';
import {
  checkDeterminism, checkDomainEqualsStorage, checkFreshObjects, checkJournalShape, checkPeriodAligned, checkWindowsInterleaved,
} from './checks.ts';
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
  });

  it('T-009 К16-доп.1: первое и последнее событие каждой из 200 позиций — в крайних 5% периода журнала', () => {
    checkPeriodAligned(journal);
  });

  it('T-009 К16-доп.2: в окнах по 1000 событий (начало, середина, конец) больше 20 различных позиций', () => {
    checkWindowsInterleaved(journal);
  });

  it('T-009 К16-доп.3: вход пути (а) — новые объекты по позиции, равные событиям журнала, остатки совпадают со свёрткой', () => {
    checkFreshObjects(journal);
  });
});
