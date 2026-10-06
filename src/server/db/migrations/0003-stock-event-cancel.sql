-- T-004 (BR-02, BR-26; ADR-003 раздел 2): отмена — событие со ссылкой на цель.
ALTER TABLE stock_events ADD COLUMN target_id TEXT;
