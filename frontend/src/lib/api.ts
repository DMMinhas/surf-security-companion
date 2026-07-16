import { z } from 'zod';
import { userManager } from './oidc';

const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Fetch wrapper: attaches the in-memory access token, propagates a request
 * id, raises typed ApiErrors, and (optionally) validates the response body
 * with a Zod schema so the UI never trusts unvalidated JSON.
 */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; schema?: z.ZodType<T> } = {},
): Promise<T> {
  const user = await userManager.getUser();
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(user?.access_token ? { authorization: `Bearer ${user.access_token}` } : {}),
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      'x-request-id': crypto.randomUUID(),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok && response.status !== 202) {
    let payload: { code?: string; message?: string; details?: unknown } = {};
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(response.status, payload.code ?? 'HTTP_ERROR', payload.message ?? response.statusText, payload.details);
  }

  const data: unknown = response.status === 204 ? undefined : await response.json();
  if (options.schema) return options.schema.parse(data);
  return data as T;
}

// ---- shared response schemas (mirror the backend DTOs) ----

export const alertSchema = z.object({
  id: z.string(),
  ts: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  ruleId: z.string(),
  ruleTitle: z.string(),
  description: z.string(),
  source: z.object({
    system: z.string(),
    host: z.string().optional(),
    userId: z.string().optional(),
    ip: z.string().optional(),
  }),
  tenantId: z.string().optional(),
  attack: z.object({ enterprise: z.array(z.string()).optional(), ics: z.array(z.string()).optional() }),
  artifacts: z.array(z.object({ type: z.string(), ref: z.string(), hash: z.string().optional() })),
  correlatedEventIds: z.array(z.string()),
  status: z.enum(['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'FALSE_POSITIVE', 'ESCALATED']),
  assignee: z.string().optional(),
  caseId: z.string().optional(),
  count: z.number(),
  firstSeen: z.string(),
  lastSeen: z.string(),
});
export type Alert = z.infer<typeof alertSchema>;

export const alertPageSchema = z.object({
  items: z.array(alertSchema),
  total: z.number(),
  nextCursor: z.string().optional(),
});

export const caseSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  tenantId: z.string().optional(),
  alerts: z.array(z.string()),
  attackTechniques: z.array(z.string()),
  actions: z.array(
    z.object({
      ts: z.string(),
      actor: z.string(),
      action: z.string(),
      outcome: z.string(),
      notes: z.string().optional(),
    }),
  ),
  status: z.enum(['OPEN', 'CONTAINED', 'ERADICATED', 'RECOVERED', 'CLOSED']),
  nis2ReportsGenerated: z.array(
    z.object({ kind: z.enum(['24h', '72h', '1m']), ts: z.string(), url: z.string(), hash: z.string() }),
  ),
  significantIncidentAt: z.string().optional(),
});
export type Case = z.infer<typeof caseSchema>;

export const casePageSchema = z.object({
  items: z.array(caseSchema),
  total: z.number(),
  nextCursor: z.string().optional(),
});

export const playbookRunSchema = z.object({
  id: z.string(),
  ts: z.string(),
  playbook: z.enum(['REVOKE_TOKEN', 'QUARANTINE_EMS']),
  actor: z.string(),
  approver: z.string().optional(),
  dryRun: z.boolean(),
  target: z.record(z.unknown()),
  reason: z.string(),
  caseId: z.string().optional(),
  status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED']),
  result: z.unknown().optional(),
  hash: z.string(),
  targetCount: z.number(),
});
export type PlaybookRun = z.infer<typeof playbookRunSchema>;

export const ruleSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  title: z.string(),
  description: z.string(),
  level: z.string(),
  tags: z.array(z.string()),
  logsource: z.object({ product: z.string().optional(), service: z.string().optional() }),
  falsepositives: z.array(z.string()),
  owner: z.string(),
  compliance: z.array(z.string()),
  enabled: z.boolean(),
  stats: z
    .object({
      ruleId: z.string(),
      firingRate24h: z.number(),
      precision: z.number().nullable(),
      lastReviewed: z.string().nullable(),
      lastFired: z.string().nullable(),
    })
    .optional(),
});
export type Rule = z.infer<typeof ruleSchema>;
