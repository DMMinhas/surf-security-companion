import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { AuditAction } from '../../../domain/entities/auditAction.js';
import type { AuditRepository } from '../../../domain/ports/repositories.js';

/**
 * Append-only, hash-chained audit store. Each row's hash covers its canonical
 * content plus the previous row's hash; the DB trigger forbids UPDATE/DELETE.
 */
export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly pool: pg.Pool) {}

  async append(action: Omit<AuditAction, 'hash' | 'prevHash'>): Promise<AuditAction> {
    // Serialise chain appends to avoid two writers reading the same prevHash.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE audit_actions IN SHARE ROW EXCLUSIVE MODE');
      const prev = await client.query<{ hash: string }>(
        'SELECT hash FROM audit_actions ORDER BY seq DESC LIMIT 1',
      );
      const prevHash = prev.rows[0]?.hash;
      const hash = createHash('sha256')
        .update(
          JSON.stringify({
            id: action.id,
            ts: action.ts,
            actor: action.actor,
            action: action.action,
            resourceType: action.resourceType,
            resourceId: action.resourceId,
            outcome: action.outcome,
            requestId: action.requestId,
            details: action.details ?? null,
            prevHash: prevHash ?? null,
          }),
        )
        .digest('hex');
      await client.query(
        `INSERT INTO audit_actions
           (id, ts, actor, roles, tenant_id, action, resource_type, resource_id, outcome, request_id, details, hash, prev_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          action.id,
          action.ts,
          action.actor,
          JSON.stringify(action.roles),
          action.tenantId ?? null,
          action.action,
          action.resourceType,
          action.resourceId,
          action.outcome,
          action.requestId,
          action.details !== undefined ? JSON.stringify(action.details) : null,
          hash,
          prevHash ?? null,
        ],
      );
      await client.query('COMMIT');
      return { ...action, hash, ...(prevHash !== undefined ? { prevHash } : {}) };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async list(filter: { actor?: string; from?: string; to?: string; limit: number }): Promise<AuditAction[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.actor !== undefined) {
      params.push(filter.actor);
      conditions.push(`actor = $${params.length}`);
    }
    if (filter.from !== undefined) {
      params.push(filter.from);
      conditions.push(`ts >= $${params.length}`);
    }
    if (filter.to !== undefined) {
      params.push(filter.to);
      conditions.push(`ts <= $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(filter.limit);
    const result = await this.pool.query(
      `SELECT * FROM audit_actions ${where} ORDER BY seq DESC LIMIT $${params.length}`,
      params,
    );
    return result.rows.map((row) => ({
      id: row.id,
      ts: new Date(row.ts).toISOString(),
      actor: row.actor,
      roles: row.roles,
      ...(row.tenant_id !== null ? { tenantId: row.tenant_id } : {}),
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      outcome: row.outcome,
      requestId: row.request_id,
      ...(row.details !== null ? { details: row.details } : {}),
      hash: row.hash,
      ...(row.prev_hash !== null ? { prevHash: row.prev_hash } : {}),
    }));
  }

  async lastHash(): Promise<string | undefined> {
    const result = await this.pool.query<{ hash: string }>(
      'SELECT hash FROM audit_actions ORDER BY seq DESC LIMIT 1',
    );
    return result.rows[0]?.hash;
  }
}
