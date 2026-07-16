import type pg from 'pg';
import type { PlaybookRun, PlaybookRunStatus } from '../../../domain/entities/playbookRun.js';
import type { HashchainLedgerEntry } from '../../../domain/entities/auditAction.js';
import type {
  HashchainRepository,
  PlaybookRunRepository,
  RuleStateRepository,
  SavedQuery,
  SavedQueryRepository,
} from '../../../domain/ports/repositories.js';
import type { RuleStats } from '../../../domain/entities/sigmaRule.js';
import { NotFoundError } from '../../../application/errors.js';

function toRun(row: Record<string, unknown>): PlaybookRun {
  return {
    id: String(row['id']),
    ts: new Date(row['ts'] as string).toISOString(),
    playbook: row['playbook'] as PlaybookRun['playbook'],
    actor: String(row['actor']),
    ...(row['approver'] !== null ? { approver: String(row['approver']) } : {}),
    dryRun: Boolean(row['dry_run']),
    target: row['target'] as Record<string, unknown>,
    reason: String(row['reason']),
    ...(row['case_id'] !== null ? { caseId: String(row['case_id']) } : {}),
    status: row['status'] as PlaybookRunStatus,
    ...(row['result'] !== null ? { result: row['result'] } : {}),
    hash: String(row['hash']),
    ...(row['prev_hash'] !== null ? { prevHash: String(row['prev_hash']) } : {}),
    ...(row['tenant_id'] !== null ? { tenantId: String(row['tenant_id']) } : {}),
    targetCount: Number(row['target_count']),
  };
}

export class PostgresPlaybookRunRepository implements PlaybookRunRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(run: PlaybookRun): Promise<PlaybookRun> {
    await this.pool.query(
      `INSERT INTO playbook_runs
         (id, ts, playbook, actor, approver, dry_run, target, target_count, reason, case_id, status, result, hash, prev_hash, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        run.id, run.ts, run.playbook, run.actor, run.approver ?? null, run.dryRun,
        JSON.stringify(run.target), run.targetCount, run.reason, run.caseId ?? null,
        run.status, run.result !== undefined ? JSON.stringify(run.result) : null,
        run.hash, run.prevHash ?? null, run.tenantId ?? null,
      ],
    );
    return run;
  }

  async getById(id: string): Promise<PlaybookRun | undefined> {
    const result = await this.pool.query('SELECT * FROM playbook_runs WHERE id = $1', [id]);
    const row = result.rows[0];
    return row ? toRun(row) : undefined;
  }

  async list(filter: { status?: PlaybookRunStatus; limit: number }): Promise<PlaybookRun[]> {
    const params: unknown[] = [];
    let where = '';
    if (filter.status !== undefined) {
      params.push(filter.status);
      where = 'WHERE status = $1';
    }
    params.push(filter.limit);
    const result = await this.pool.query(
      `SELECT * FROM playbook_runs ${where} ORDER BY seq DESC LIMIT $${params.length}`,
      params,
    );
    return result.rows.map(toRun);
  }

  async update(run: PlaybookRun): Promise<PlaybookRun> {
    const result = await this.pool.query(
      `UPDATE playbook_runs SET status = $2, approver = $3, result = $4 WHERE id = $1 RETURNING *`,
      [run.id, run.status, run.approver ?? null, run.result !== undefined ? JSON.stringify(run.result) : null],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('PlaybookRun', run.id);
    return toRun(row);
  }

  async lastHash(): Promise<string | undefined> {
    const result = await this.pool.query<{ hash: string }>(
      'SELECT hash FROM playbook_runs ORDER BY seq DESC LIMIT 1',
    );
    return result.rows[0]?.hash;
  }
}

export class PostgresHashchainRepository implements HashchainRepository {
  constructor(private readonly pool: pg.Pool) {}

  async append(entry: HashchainLedgerEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO hashchain_ledger (hour, root, sig, index_count, byte_count, prev_hour, prev_root, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        entry.hour, entry.root, entry.sig, entry.indexCount, entry.byteCount,
        entry.prevHour ?? null, entry.prevRoot ?? null, entry.createdAt,
      ],
    );
  }

  async latest(): Promise<HashchainLedgerEntry | undefined> {
    const result = await this.pool.query('SELECT * FROM hashchain_ledger ORDER BY hour DESC LIMIT 1');
    const row = result.rows[0];
    return row ? this.toEntry(row) : undefined;
  }

  async range(fromHour: string, toHour: string): Promise<HashchainLedgerEntry[]> {
    const result = await this.pool.query(
      'SELECT * FROM hashchain_ledger WHERE hour >= $1 AND hour <= $2 ORDER BY hour ASC',
      [fromHour, toHour],
    );
    return result.rows.map((row) => this.toEntry(row));
  }

  private toEntry(row: Record<string, unknown>): HashchainLedgerEntry {
    return {
      hour: new Date(row['hour'] as string).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      root: String(row['root']),
      sig: String(row['sig']),
      indexCount: Number(row['index_count']),
      byteCount: Number(row['byte_count']),
      ...(row['prev_hour'] !== null
        ? { prevHour: new Date(row['prev_hour'] as string).toISOString().replace(/\.\d{3}Z$/, 'Z') }
        : {}),
      ...(row['prev_root'] !== null ? { prevRoot: String(row['prev_root']) } : {}),
      createdAt: new Date(row['created_at'] as string).toISOString(),
    };
  }
}

export class PostgresSavedQueryRepository implements SavedQueryRepository {
  constructor(private readonly pool: pg.Pool) {}

  async create(q: SavedQuery): Promise<SavedQuery> {
    await this.pool.query(
      'INSERT INTO saved_queries (id, name, owner, tenant_id, query, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [q.id, q.name, q.owner, q.tenantId ?? null, JSON.stringify(q.query), q.createdAt],
    );
    return q;
  }

  async listByOwner(owner: string): Promise<SavedQuery[]> {
    const result = await this.pool.query('SELECT * FROM saved_queries WHERE owner = $1 ORDER BY created_at DESC', [
      owner,
    ]);
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      owner: row.owner,
      ...(row.tenant_id !== null ? { tenantId: row.tenant_id } : {}),
      query: row.query,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
}

export class PostgresRuleStateRepository implements RuleStateRepository {
  constructor(private readonly pool: pg.Pool) {}

  async isEnabled(ruleId: string): Promise<boolean> {
    const result = await this.pool.query<{ enabled: boolean }>(
      'SELECT enabled FROM rule_state WHERE rule_id = $1',
      [ruleId],
    );
    return result.rows[0]?.enabled ?? true; // rules default to enabled
  }

  async setEnabled(ruleId: string, enabled: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO rule_state (rule_id, enabled, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (rule_id) DO UPDATE SET enabled = $2, updated_at = now()`,
      [ruleId, enabled],
    );
  }

  async stats(ruleIds: string[]): Promise<RuleStats[]> {
    const result = await this.pool.query<{ rule_id: string; last_reviewed: Date | null }>(
      'SELECT rule_id, last_reviewed FROM rule_state WHERE rule_id = ANY($1)',
      [ruleIds],
    );
    const reviewed = new Map(result.rows.map((r) => [r.rule_id, r.last_reviewed]));
    // Firing rate & precision come from the alert store aggregations in the
    // route layer; here we return the persisted review metadata.
    return ruleIds.map((ruleId) => ({
      ruleId,
      firingRate24h: 0,
      precision: null,
      lastReviewed: reviewed.get(ruleId)?.toISOString() ?? null,
      lastFired: null,
    }));
  }
}
