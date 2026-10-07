-- T-004: каталог, журнал остатка, журнал состояний (ADR-002, ADR-003 §4, §7).
-- Остатка в схеме нет (BR-01, инвариант 1). Время — канон YYYY-MM-DDTHH:mm:ss.sssZ (NFR-14):
-- strftime возвращает ту же строку только для канонической и существующей даты.

CREATE TABLE product (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  write_off_type TEXT NOT NULL CHECK (write_off_type IN ('rhythmic', 'burst', 'slow', 'unset')),
  unit TEXT NOT NULL CHECK (unit IN ('г', 'мл', 'шт')),
  pack_name TEXT NOT NULL,
  units_per_pack REAL NOT NULL,
  norm REAL,
  low_threshold REAL,
  portion REAL
) STRICT;

CREATE TABLE stock_event (
  id TEXT NOT NULL PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  product_id TEXT NOT NULL REFERENCES product (id),
  kind TEXT NOT NULL CHECK (kind IN
    ('purchase', 'portion', 'auto_writeoff', 'recipe', 'spoilage', 'inventory', 'depleted', 'cancel')),
  quantity REAL,
  value REAL,
  packs REAL,
  units_per_pack REAL,
  target_id TEXT,
  occurred_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', occurred_at) = occurred_at),
  recorded_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', recorded_at) = recorded_at),
  source TEXT NOT NULL
) STRICT;
CREATE INDEX stock_event_product ON stock_event (product_id, occurred_at, seq);

CREATE TABLE state_event (
  id TEXT NOT NULL PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  product_id TEXT NOT NULL REFERENCES product (id),
  state TEXT NOT NULL CHECK (state IN ('active', 'inactive')),
  reason TEXT NOT NULL CHECK (reason IN ('user_button', 'auto_archive', 'purchase', 'user_restore')),
  ref_event_id TEXT,
  occurred_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', occurred_at) = occurred_at),
  recorded_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', recorded_at) = recorded_at)
) STRICT;
CREATE INDEX state_event_product ON state_event (product_id, occurred_at, seq);

-- Append-only (BR-02, NFR-08). BEFORE INSERT закрывает INSERT OR REPLACE: он не вызывает BEFORE DELETE.
CREATE TRIGGER stock_event_no_update BEFORE UPDATE ON stock_event
BEGIN SELECT RAISE(ABORT, 'stock_event is append-only'); END;
CREATE TRIGGER stock_event_no_delete BEFORE DELETE ON stock_event
BEGIN SELECT RAISE(ABORT, 'stock_event is append-only'); END;
CREATE TRIGGER stock_event_no_replace BEFORE INSERT ON stock_event
WHEN EXISTS (SELECT 1 FROM stock_event WHERE id = NEW.id OR seq = NEW.seq)
BEGIN SELECT RAISE(ABORT, 'stock_event is append-only'); END;

CREATE TRIGGER state_event_no_update BEFORE UPDATE ON state_event
BEGIN SELECT RAISE(ABORT, 'state_event is append-only'); END;
CREATE TRIGGER state_event_no_delete BEFORE DELETE ON state_event
BEGIN SELECT RAISE(ABORT, 'state_event is append-only'); END;
CREATE TRIGGER state_event_no_replace BEFORE INSERT ON state_event
WHEN EXISTS (SELECT 1 FROM state_event WHERE id = NEW.id OR seq = NEW.seq)
BEGIN SELECT RAISE(ABORT, 'state_event is append-only'); END;
