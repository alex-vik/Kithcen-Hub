-- T-010, FR-CON-08, ADR-005: курсор суточных задач. Остатка здесь нет (BR-01).
CREATE TABLE job_runs (
  job TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (job, day)
) STRICT;
