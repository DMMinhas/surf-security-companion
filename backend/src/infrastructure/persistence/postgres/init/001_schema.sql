-- SURF Security Companion — portal state schema (Postgres 17, pgaudit enabled)
-- Applied by the container entrypoint on first boot; migrations beyond MVP
-- should move to a dedicated tool (e.g. node-pg-migrate).

CREATE EXTENSION IF NOT EXISTS pgaudit;

CREATE TABLE IF NOT EXISTS cases (
  id            UUID PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL,
  created_by    TEXT        NOT NULL,
  title         TEXT        NOT NULL,
  description   TEXT        NOT NULL DEFAULT '',
  severity      TEXT        NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  tenant_id     TEXT,
  status        TEXT        NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN','CONTAINED','ERADICATED','RECOVERED','CLOSED')),
  alerts        JSONB       NOT NULL DEFAULT '[]',
  attack_techniques JSONB   NOT NULL DEFAULT '[]',
  actions       JSONB       NOT NULL DEFAULT '[]',
  nis2_reports  JSONB       NOT NULL DEFAULT '[]',
  significant_incident_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cases_tenant ON cases (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases (status);

CREATE TABLE IF NOT EXISTS playbook_runs (
  id           UUID PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL,
  playbook     TEXT NOT NULL CHECK (playbook IN ('REVOKE_TOKEN','QUARANTINE_EMS')),
  actor        TEXT NOT NULL,
  approver     TEXT,
  dry_run      BOOLEAN NOT NULL,
  target       JSONB NOT NULL,
  target_count INTEGER NOT NULL,
  reason       TEXT NOT NULL,
  case_id      UUID,
  status       TEXT NOT NULL CHECK (status IN ('REQUESTED','APPROVED','REJECTED','EXECUTED','FAILED')),
  result       JSONB,
  hash         TEXT NOT NULL,
  prev_hash    TEXT,
  tenant_id    TEXT,
  seq          BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX IF NOT EXISTS idx_playbook_runs_status ON playbook_runs (status);

-- Append-only: no UPDATE/DELETE grants; enforced additionally by trigger.
CREATE TABLE IF NOT EXISTS audit_actions (
  id            UUID PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL,
  actor         TEXT NOT NULL,
  roles         JSONB NOT NULL DEFAULT '[]',
  tenant_id     TEXT,
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT NOT NULL,
  outcome       TEXT NOT NULL CHECK (outcome IN ('success','failure','denied')),
  request_id    TEXT NOT NULL,
  details       JSONB,
  hash          TEXT NOT NULL,
  prev_hash     TEXT,
  seq           BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX IF NOT EXISTS idx_audit_actions_ts ON audit_actions (ts);
CREATE INDEX IF NOT EXISTS idx_audit_actions_actor ON audit_actions (actor);

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_actions is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_actions_append_only ON audit_actions;
CREATE TRIGGER audit_actions_append_only
  BEFORE UPDATE OR DELETE ON audit_actions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE IF NOT EXISTS hashchain_ledger (
  hour        TIMESTAMPTZ PRIMARY KEY,
  root        TEXT NOT NULL,
  sig         TEXT NOT NULL,
  index_count INTEGER NOT NULL,
  byte_count  BIGINT  NOT NULL,
  prev_hour   TIMESTAMPTZ,
  prev_root   TEXT,
  created_at  TIMESTAMPTZ NOT NULL
);

DROP TRIGGER IF EXISTS hashchain_ledger_append_only ON hashchain_ledger;
CREATE TRIGGER hashchain_ledger_append_only
  BEFORE UPDATE OR DELETE ON hashchain_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE IF NOT EXISTS saved_queries (
  id         UUID PRIMARY KEY,
  name       TEXT NOT NULL,
  owner      TEXT NOT NULL,
  tenant_id  TEXT,
  query      JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_queries_owner ON saved_queries (owner);

CREATE TABLE IF NOT EXISTS rule_state (
  rule_id       TEXT PRIMARY KEY,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  last_reviewed TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tenants (id, name) VALUES
  ('vnb-saar',  'VNB Saar Netz GmbH'),
  ('vnb-pfalz', 'VNB Pfalzwerke Netz AG')
ON CONFLICT (id) DO NOTHING;
