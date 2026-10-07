-- T-012, FR-ABS-01, BR-02, ADR-005: периоды отпуска, только добавление. Остатка здесь нет (BR-01).
CREATE TABLE absence_period (
  id TEXT PRIMARY KEY,
  start_day TEXT NOT NULL,
  end_day TEXT NOT NULL,
  recorded_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER absence_period_no_update BEFORE UPDATE ON absence_period
BEGIN SELECT RAISE(ABORT, 'absence_period is append-only'); END;
CREATE TRIGGER absence_period_no_delete BEFORE DELETE ON absence_period
BEGIN SELECT RAISE(ABORT, 'absence_period is append-only'); END;
CREATE TRIGGER absence_period_no_replace BEFORE INSERT ON absence_period
WHEN EXISTS (SELECT 1 FROM absence_period WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'absence_period is append-only'); END;
