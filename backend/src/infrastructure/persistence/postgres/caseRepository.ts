import type pg from 'pg';
import type { Case, CaseAction, CaseStatus, Nis2ReportRef } from '../../../domain/entities/case.js';
import type { CaseQuery, CaseRepository, Page } from '../../../domain/ports/repositories.js';
import { NotFoundError } from '../../../application/errors.js';

interface CaseRow {
  id: string;
  created_at: Date;
  created_by: string;
  title: string;
  description: string;
  severity: Case['severity'];
  tenant_id: string | null;
  status: CaseStatus;
  alerts: string[];
  attack_techniques: string[];
  actions: CaseAction[];
  nis2_reports: Nis2ReportRef[];
  significant_incident_at: Date | null;
}

function toCase(row: CaseRow): Case {
  return {
    id: row.id,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
    title: row.title,
    description: row.description,
    severity: row.severity,
    ...(row.tenant_id !== null ? { tenantId: row.tenant_id } : {}),
    alerts: row.alerts,
    attackTechniques: row.attack_techniques,
    actions: row.actions,
    status: row.status,
    nis2ReportsGenerated: row.nis2_reports,
    ...(row.significant_incident_at !== null
      ? { significantIncidentAt: row.significant_incident_at.toISOString() }
      : {}),
  };
}

export class PostgresCaseRepository implements CaseRepository {
  constructor(private readonly pool: pg.Pool) {}

  async list(query: CaseQuery): Promise<Page<Case>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.tenantId !== undefined) {
      params.push(query.tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }
    if (query.status !== undefined) {
      params.push(query.status);
      conditions.push(`status = $${params.length}`);
    }
    const offset = query.cursor !== undefined ? Number.parseInt(query.cursor, 10) || 0 : 0;
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(query.limit, offset);
    const result = await this.pool.query<CaseRow & { total: string }>(
      `SELECT *, count(*) OVER() AS total FROM cases ${where}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const total = result.rows[0] ? Number(result.rows[0].total) : 0;
    const next = offset + result.rows.length;
    return {
      items: result.rows.map(toCase),
      total,
      ...(next < total ? { nextCursor: String(next) } : {}),
    };
  }

  async getById(id: string, tenantId?: string): Promise<Case | undefined> {
    const params: unknown[] = [id];
    let sql = 'SELECT * FROM cases WHERE id = $1';
    if (tenantId !== undefined) {
      params.push(tenantId);
      sql += ' AND tenant_id = $2';
    }
    const result = await this.pool.query<CaseRow>(sql, params);
    const row = result.rows[0];
    return row ? toCase(row) : undefined;
  }

  async create(c: Case): Promise<Case> {
    await this.pool.query(
      `INSERT INTO cases (id, created_at, created_by, title, description, severity, tenant_id,
                          status, alerts, attack_techniques, actions, nis2_reports, significant_incident_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        c.id,
        c.createdAt,
        c.createdBy,
        c.title,
        c.description,
        c.severity,
        c.tenantId ?? null,
        c.status,
        JSON.stringify(c.alerts),
        JSON.stringify(c.attackTechniques),
        JSON.stringify(c.actions),
        JSON.stringify(c.nis2ReportsGenerated),
        c.significantIncidentAt ?? null,
      ],
    );
    return c;
  }

  async setStatus(id: string, status: CaseStatus): Promise<Case> {
    const result = await this.pool.query<CaseRow>(
      'UPDATE cases SET status = $2 WHERE id = $1 RETURNING *',
      [id, status],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Case', id);
    return toCase(row);
  }

  async addAction(id: string, action: CaseAction): Promise<Case> {
    const result = await this.pool.query<CaseRow>(
      `UPDATE cases SET actions = actions || $2::jsonb WHERE id = $1 RETURNING *`,
      [id, JSON.stringify([action])],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Case', id);
    return toCase(row);
  }

  async addAlerts(id: string, alertIds: string[]): Promise<Case> {
    const result = await this.pool.query<CaseRow>(
      `UPDATE cases
       SET alerts = (SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements(alerts || $2::jsonb) AS t(v))
       WHERE id = $1 RETURNING *`,
      [id, JSON.stringify(alertIds)],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Case', id);
    return toCase(row);
  }

  async addNis2Report(id: string, ref: Nis2ReportRef): Promise<Case> {
    const result = await this.pool.query<CaseRow>(
      `UPDATE cases SET nis2_reports = nis2_reports || $2::jsonb WHERE id = $1 RETURNING *`,
      [id, JSON.stringify([ref])],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Case', id);
    return toCase(row);
  }

  async markSignificant(id: string, at: string): Promise<Case> {
    const result = await this.pool.query<CaseRow>(
      `UPDATE cases SET significant_incident_at = $2 WHERE id = $1 AND significant_incident_at IS NULL RETURNING *`,
      [id, at],
    );
    const row = result.rows[0];
    if (row) return toCase(row);
    const existing = await this.getById(id);
    if (!existing) throw new NotFoundError('Case', id);
    return existing;
  }
}
