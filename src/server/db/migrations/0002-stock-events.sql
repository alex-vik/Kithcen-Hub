-- T-002, T-003 (BR-01, BR-02, NFR-08; ADR-003 раздел 1). Остатка нет ни в какой колонке (инвариант 1).
CREATE TABLE stock_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL,
  qty REAL,
  occurred_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL
);

CREATE INDEX stock_events_product_time ON stock_events (product_id, occurred_at);

CREATE TRIGGER stock_events_no_update BEFORE UPDATE ON stock_events
BEGIN SELECT RAISE(ABORT, 'stock_events is append-only'); END;
CREATE TRIGGER stock_events_no_delete BEFORE DELETE ON stock_events
BEGIN SELECT RAISE(ABORT, 'stock_events is append-only'); END;
