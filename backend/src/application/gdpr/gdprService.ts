import { createHash } from 'node:crypto';
import type { EventStore } from '../../domain/ports/repositories.js';
import type { BlobStore } from '../../domain/ports/connectors.js';
import type { CallerContext } from '../context.js';
import type { AuditService } from '../audit/auditService.js';
import { ValidationError } from '../errors.js';

const PSEUDONYM_PATTERN = /^[A-Za-z0-9_-]{4,128}$/;

export interface GdprConfig {
  auditBucket: string;
  presignExpirySeconds: number;
}

/**
 * GDPR data-subject workflows over the pseudonymised prosumer id
 * (`surf.prosumer.pseudonym`). The SOC never holds direct identifiers;
 * re-identification happens at the VNB under its own controls.
 */
export class GdprService {
  constructor(
    private readonly events: EventStore,
    private readonly blobs: BlobStore,
    private readonly audit: AuditService,
    private readonly config: GdprConfig,
  ) {}

  /** Art. 15 — export every stored event referencing the pseudonym. */
  async subjectAccess(caller: CallerContext, pseudonym: string): Promise<{ url: string; hash: string; count: number }> {
    this.assertPseudonym(pseudonym);
    const docs = await this.events.eventsForSubject(pseudonym);
    const body = Buffer.from(JSON.stringify({ pseudonym, exportedAt: new Date().toISOString(), events: docs }, null, 2));
    const hash = createHash('sha256').update(body).digest('hex');
    const key = `gdpr/access/${pseudonym}/${Date.now()}.json`;
    await this.blobs.putWorm(this.config.auditBucket, key, body, 'application/json');
    const url = await this.blobs.presignedGetUrl(this.config.auditBucket, key, this.config.presignExpirySeconds);
    await this.audit.record(caller, {
      action: 'gdpr.subject-access',
      resourceType: 'prosumer',
      resourceId: pseudonym,
      outcome: 'success',
      details: { count: docs.length, hash },
    });
    return { url, hash, count: docs.length };
  }

  /**
   * Art. 17 — flag for erasure at end-of-retention. Security logs are exempt
   * from immediate erasure (Art. 17(3)(b), NIS2 retention duty); the flag is
   * honoured by the retention job when the WORM/retention clock expires.
   */
  async requestErasure(caller: CallerContext, pseudonym: string): Promise<{ flagged: true; effectiveAfterRetention: true }> {
    this.assertPseudonym(pseudonym);
    await this.audit.record(caller, {
      action: 'gdpr.erasure-flagged',
      resourceType: 'prosumer',
      resourceId: pseudonym,
      outcome: 'success',
      details: { legalBasis: 'Art.17(3)(b) — erasure deferred to end of statutory retention' },
    });
    return { flagged: true, effectiveAfterRetention: true };
  }

  private assertPseudonym(pseudonym: string): void {
    if (!PSEUDONYM_PATTERN.test(pseudonym)) {
      throw new ValidationError('invalid pseudonym format');
    }
  }
}
