import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PostgresCaseRepository } from '../../src/infrastructure/persistence/postgres/caseRepository.js';
import { PostgresAuditRepository } from '../../src/infrastructure/persistence/postgres/auditRepository.js';
import type { Case } from '../../src/domain/entities/case.js';

/**
 * Real Postgres via Testcontainers. Verifies repository SQL, the append-only
 * audit hash-chain, and tenant-filtered reads. Skipped automatically when no
 * Docker daemon is reachable (CI provides one).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const initSql = readFileSync(
  path.resolve(here, '../../src/infrastructure/persistence/postgres/init/001_schema.sql'),
  'utf8',
).replace('CREATE EXTENSION IF NOT EXISTS pgaudit;', ''); // pgaudit not present in the plain image

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;

function makeCase(over: Partial<Case> = {}): Case {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    createdBy: 'anna',
    title: 'Suspicious curtailment',
    description: 'demo',
    severity: 'high',
    tenantId: 'vnb-saar',
    alerts: [],
    attackTechniques: ['T0813'],
    actions: [{ ts: new Date().toISOString(), actor: 'anna', action: 'created', outcome: 'ok' }],
    status: 'OPEN',
    nis2ReportsGenerated: [],
    ...over,
  };
}

describe.sequential('Postgres repositories (Testcontainers)', () => {
  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    await pool.query(initSql);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('creates and reads a case, scoped by tenant', async () => {
    const repo = new PostgresCaseRepository(pool);
    const created = await repo.create(makeCase());
    const sameTenant = await repo.getById(created.id, 'vnb-saar');
    const otherTenant = await repo.getById(created.id, 'vnb-pfalz');
    expect(sameTenant?.id).toBe(created.id);
    expect(otherTenant).toBeUndefined();
  });

  it('appends actions and NIS2 reports immutably-forward', async () => {
    const repo = new PostgresCaseRepository(pool);
    const created = await repo.create(makeCase());
    await repo.addAction(created.id, { ts: new Date().toISOString(), actor: 'anna', action: 'contained', outcome: 'ok' });
    const withReport = await repo.addNis2Report(created.id, {
      kind: '24h',
      ts: new Date().toISOString(),
      url: 'k',
      hash: 'abc',
    });
    expect(withReport.actions.length).toBe(2);
    expect(withReport.nis2ReportsGenerated[0]?.hash).toBe('abc');
  });

  it('marks significant incident once (idempotent)', async () => {
    const repo = new PostgresCaseRepository(pool);
    const created = await repo.create(makeCase());
    const first = await repo.markSignificant(created.id, '2026-07-14T00:00:00Z');
    const second = await repo.markSignificant(created.id, '2026-07-15T00:00:00Z');
    expect(first.significantIncidentAt).toBe(second.significantIncidentAt);
  });

  it('audit_actions is append-only and hash-chained', async () => {
    const repo = new PostgresAuditRepository(pool);
    const a = await repo.append({
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      actor: 'anna',
      roles: ['SOC_ANALYST'],
      action: 'test.one',
      resourceType: 'test',
      resourceId: '1',
      outcome: 'success',
      requestId: 'r1',
    });
    const b = await repo.append({
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      actor: 'anna',
      roles: ['SOC_ANALYST'],
      action: 'test.two',
      resourceType: 'test',
      resourceId: '2',
      outcome: 'success',
      requestId: 'r2',
    });
    expect(b.prevHash).toBe(a.hash);

    // UPDATE/DELETE must be rejected by the trigger
    await expect(pool.query('UPDATE audit_actions SET actor = $1 WHERE id = $2', ['x', a.id])).rejects.toThrow(
      /append-only/,
    );
    await expect(pool.query('DELETE FROM audit_actions WHERE id = $1', [a.id])).rejects.toThrow(/append-only/);
  });
});
