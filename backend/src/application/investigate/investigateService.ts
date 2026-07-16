import type { EventStore, SavedQuery, SavedQueryRepository } from '../../domain/ports/repositories.js';
import type { CallerContext } from '../context.js';
import { ValidationError } from '../errors.js';
import { isCrossTenant } from '../../domain/valueObjects/role.js';

/** Fields the pivot bar may pivot on — a strict allow-list, never user-supplied field names. */
export const PIVOTABLE_FIELDS = [
  'source.ip',
  'user.name',
  'host.name',
  'surf.tenant.id',
  'surf.ems.id',
  'surf.command.id',
  'surf.grid.section',
  'surf.trade.cycle_id',
  'surf.prosumer.pseudonym',
] as const;
export type PivotableField = (typeof PIVOTABLE_FIELDS)[number];

export class InvestigateService {
  constructor(
    private readonly events: EventStore,
    private readonly savedQueries: SavedQueryRepository,
  ) {}

  private tenantOf(caller: CallerContext): string | undefined {
    return isCrossTenant(caller.roles) ? undefined : caller.tenantId;
  }

  async query(
    caller: CallerContext,
    input: { query: Record<string, unknown>; from?: string; to?: string; limit?: number },
  ): Promise<Array<Record<string, unknown>>> {
    const limit = Math.min(input.limit ?? 100, 1000);
    return this.events.search({
      ...(this.tenantOf(caller) !== undefined ? { tenantId: this.tenantOf(caller) } : {}),
      query: input.query,
      ...(input.from !== undefined ? { from: input.from } : {}),
      ...(input.to !== undefined ? { to: input.to } : {}),
      limit,
    });
  }

  async pivot(caller: CallerContext, field: string, value: string): Promise<Array<Record<string, unknown>>> {
    if (!(PIVOTABLE_FIELDS as readonly string[]).includes(field)) {
      throw new ValidationError(`field ${field} is not pivotable`, { allowed: PIVOTABLE_FIELDS });
    }
    if (value.length === 0 || value.length > 512) throw new ValidationError('pivot value length out of range');
    return this.events.pivot(field, value, this.tenantOf(caller));
  }

  async saveQuery(caller: CallerContext, name: string, query: Record<string, unknown>): Promise<SavedQuery> {
    if (!name.trim() || name.length > 120) throw new ValidationError('query name must be 1-120 chars');
    return this.savedQueries.create({
      id: crypto.randomUUID(),
      name: name.trim(),
      owner: caller.username,
      ...(this.tenantOf(caller) !== undefined ? { tenantId: this.tenantOf(caller) } : {}),
      query,
      createdAt: new Date().toISOString(),
    });
  }

  async listSavedQueries(caller: CallerContext): Promise<SavedQuery[]> {
    return this.savedQueries.listByOwner(caller.username);
  }
}
