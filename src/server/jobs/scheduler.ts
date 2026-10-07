// T-010, ADR-005, ADR-003a §4.4, NFR-07: тик планировщика = автосписание, затем прогрев кэша остатков.
import type { LocalDate } from '../../domain/time.ts';

export type SchedulerDeps = {
  autoWriteoff: { runPending(): { processed: LocalDate[] } };
  balances: { warm(): void };
  log: (message: string, error: unknown) => void;
  tickMinutes: number;
};

/** Тик при старте синхронно, далее раз в tickMinutes. Исключений наружу не бросает. */
export function startScheduler({ autoWriteoff, balances, log, tickMinutes }: SchedulerDeps): { tick(): void; stop(): void } {
  function tick(): void {
    try {
      autoWriteoff.runPending();
    } catch (err) {
      log('автосписание: сбой тика', err);
    }
    try {
      balances.warm(); // вне транзакций, после фиксации суток
    } catch (err) {
      log('прогрев кэша остатков: сбой', err);
    }
  }
  tick();
  const timer = setInterval(tick, tickMinutes * 60_000);
  return { tick, stop: () => clearInterval(timer) };
}
