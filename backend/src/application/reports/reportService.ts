import { createHash } from 'node:crypto';
import type { CaseRepository, EventStore, HashchainRepository } from '../../domain/ports/repositories.js';
import type { BlobStore } from '../../domain/ports/connectors.js';
import type { CallerContext } from '../context.js';
import type { AuditService } from '../audit/auditService.js';
import { StepUpRequiredError } from '../errors.js';
import { merkleRoot, contentHash } from '../merkleChain/merkle.js';
import { isCrossTenant } from '../../domain/valueObjects/role.js';

export interface ReportConfig {
  auditBucket: string;
  presignExpirySeconds: number;
  requireStepUp: boolean;
}

/**
 * KRITIS quarterly export and ad-hoc audit exports. Every bundle carries a
 * manifest whose own Merkle root is computed over the bundle contents, so an
 * auditor can verify the export independently of the live hash chain.
 */
export class ReportService {
  constructor(
    private readonly cases: CaseRepository,
    private readonly events: EventStore,
    private readonly ledger: HashchainRepository,
    private readonly blobs: BlobStore,
    private readonly audit: AuditService,
    private readonly config: ReportConfig,
  ) {}

  private assertStepUp(caller: CallerContext): void {
    if (this.config.requireStepUp && !caller.mfaVerified) throw new StepUpRequiredError();
  }

  async kritisQuarterly(caller: CallerContext, quarter: string): Promise<{ url: string; hash: string; root: string }> {
    this.assertStepUp(caller);
    const tenantId = isCrossTenant(caller.roles) ? undefined : caller.tenantId;
    const page = await this.cases.list({ limit: 10_000, ...(tenantId !== undefined ? { tenantId } : {}) });

    const documents = page.items.map((c) => ({ path: `cases/${c.id}.json`, body: JSON.stringify(c, null, 2) }));
    return this.storeBundle(caller, `kritis/${quarter}`, 'report.kritis-quarterly', documents, { quarter, tenantId });
  }

  async auditExport(
    caller: CallerContext,
    range: { from: string; to: string },
  ): Promise<{ url: string; hash: string; root: string; eventCount: number }> {
    this.assertStepUp(caller);
    const ledgerEntries = await this.ledger.range(range.from, range.to);
    const events = await this.events.searchWindow(range.from, range.to);

    const documents = [
      { path: 'ledger.json', body: JSON.stringify(ledgerEntries, null, 2) },
      { path: 'events.ndjson', body: events.map((e) => JSON.stringify(e)).join('\n') },
    ];
    const result = await this.storeBundle(caller, `audit-export/${range.from}--${range.to}`, 'report.audit-export', documents, range);
    return { ...result, eventCount: events.length };
  }

  private async storeBundle(
    caller: CallerContext,
    keyPrefix: string,
    action: string,
    documents: Array<{ path: string; body: string }>,
    details: Record<string, unknown>,
  ): Promise<{ url: string; hash: string; root: string }> {
    // Independent Merkle root over the bundle contents (separate from the live chain).
    const root = merkleRoot(
      documents.map((d) => ({ id: d.path, contentHash: contentHash({ body: d.body }) })),
    );
    const manifest = {
      generatedAt: new Date().toISOString(),
      generatedBy: caller.username,
      root,
      files: documents.map((d) => ({
        path: d.path,
        sha256: createHash('sha256').update(d.body).digest('hex'),
        bytes: Buffer.byteLength(d.body),
      })),
    };
    const bundle = Buffer.from(
      JSON.stringify({ manifest, documents: Object.fromEntries(documents.map((d) => [d.path, d.body])) }, null, 2),
    );
    const hash = createHash('sha256').update(bundle).digest('hex');
    const key = `${keyPrefix}/${Date.now()}.bundle.json`;
    await this.blobs.putWorm(this.config.auditBucket, key, bundle, 'application/json');
    const url = await this.blobs.presignedGetUrl(this.config.auditBucket, key, this.config.presignExpirySeconds);
    await this.audit.record(caller, {
      action,
      resourceType: 'report',
      resourceId: key,
      outcome: 'success',
      details: { ...details, hash, root },
    });
    return { url, hash, root };
  }
}
