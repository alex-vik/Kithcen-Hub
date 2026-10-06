-- T-001 (FR-CAT-01, FR-CAT-02, FR-CAT-08; ADR-003 раздел 4). Остатка в products нет (инвариант 1).
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  write_off_type TEXT,
  consumption_unit TEXT NOT NULL,
  package_name TEXT,
  package_factor REAL,
  norm REAL,
  low_stock_threshold REAL,
  portion REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE product_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id),
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  before TEXT,
  after TEXT,
  cause_event_id TEXT,
  reverts_id INTEGER REFERENCES product_changes(id)
);

CREATE TRIGGER product_changes_no_update BEFORE UPDATE ON product_changes
BEGIN SELECT RAISE(ABORT, 'product_changes is append-only'); END;
CREATE TRIGGER product_changes_no_delete BEFORE DELETE ON product_changes
BEGIN SELECT RAISE(ABORT, 'product_changes is append-only'); END;
