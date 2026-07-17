import type { EventStore, HashchainRepository } from '../../domain/ports/repositories.js';
import type { BlobStore, Signer } from '../../domain/ports/connectors.js';
import type { HashchainLedgerEntry } from '../../domain/entities/auditAction.js';
import { merkleRoot } from './merkle.js';
import type { Logger } from 'pino';

export interface HashchainConfig {
  hashchainBucket: string;
  rollupIntervalMinutes: number;
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  failures: Array<{ hour: string; reason: string }>;
}

/**
 * Hourly rollup: Merkle root over every event indexed in the previous hour,
 * Ed25519-signed, chained to the previous root, persisted to BOTH the
 * Postgres ledger and MinIO Object-Lock (WORM). Either copy alone is enough
 * to detect tampering of the other.
 */
export class MerkleChainService {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly events: EventStore,
    private readonly ledger: HashchainRepository,
    private readonly blobs: BlobStore,
    private readonly signer: Signer,
    private readonly config: HashchainConfig,
    private readonly log: Logger,
    private readonly onRollup?: (success: boolean) => void,
  ) {}

  start(): void {
    const intervalMs = this.config.rollupIntervalMinutes * 60_000;
    this.timer = setInterval(() => {
      void this.rollupDue().catch((err) => {
        this.log.error({ err }, 'hash-chain rollup failed');
        this.onRollup?.(false);
      });
    }, intervalMs);
    this.timer.unref();
    this.log.info({ intervalMinutes: this.config.rollupIntervalMinutes }, 'hash-chain scheduler started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Hour bucket that ended most recently, ISO with :00 minutes. */
  static previousHourBucket(now: Date): string {
    const d = new Date(now);
    d.setUTCMinutes(0, 0, 0);
    d.setUTCHours(d.getUTCHours() - 1);
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  /** The hour bucket one hour after `hourIso`. */
  static addHour(hourIso: string): string {
    const d = new Date(hourIso);
    d.setUTCHours(d.getUTCHours() + 1);
    return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  /**
   * Contiguous hour buckets that still need notarising: from the hour after
   * `lastHour` through `target` inclusive (capped per call so a long outage
   * catches up over several ticks rather than one huge loop). With no ledger
   * yet, only `target` — history before first boot is not retro-notarised.
   */
  static hoursBetween(lastHour: string | undefined, target: string, cap = 168): string[] {
    if (lastHour === undefined) return [target];
    const targetMs = Date.parse(target);
    const hours: string[] = [];
    for (let h = MerkleChainService.addHour(lastHour); Date.parse(h) <= targetMs && hours.length < cap; h = MerkleChainService.addHour(h)) {
      hours.push(h);
    }
    return hours;
  }

  async rollupPreviousHour(now: Date = new Date()): Promise<HashchainLedgerEntry> {
    const hour = MerkleChainService.previousHourBucket(now);
    const entry = await this.rollupHour(hour);
    this.onRollup?.(true);
    return entry;
  }

  /**
   * Notarises every hour still missing from the ledger up to the most recent
   * complete hour, oldest first. This makes a transient signer/WORM failure
   * self-healing: the failed hour is simply re-attempted on the next tick
   * (rollupHour appends nothing until both WORM and ledger succeed), instead of
   * being permanently skipped when the scheduler advances to the next hour.
   */
  async rollupDue(now: Date = new Date()): Promise<HashchainLedgerEntry[]> {
    const target = MerkleChainService.previousHourBucket(now);
    const last = await this.ledger.latest();
    const done: HashchainLedgerEntry[] = [];
    for (const hour of MerkleChainService.hoursBetween(last?.hour, target)) {
      done.push(await this.rollupHour(hour)); // throws on failure → retried next tick
      this.onRollup?.(true);
    }
    return done;
  }

  async rollupHour(hour: string): Promise<HashchainLedgerEntry> {
    const leaves = await this.events.eventsInHour(hour);
    const root = merkleRoot(leaves.map((l) => ({ id: l.id, contentHash: l.contentHash })));
    const prev = await this.ledger.latest();

    const message = new TextEncoder().encode(`${hour}:${root}:${prev?.root ?? ''}`);
    const sig = Buffer.from(await this.signer.sign(message)).toString('hex');

    const entry: HashchainLedgerEntry = {
      hour,
      root,
      sig,
      indexCount: leaves.length,
      byteCount: leaves.reduce((acc, l) => acc + l.bytes, 0),
      ...(prev !== undefined ? { prevHour: prev.hour, prevRoot: prev.root } : {}),
      createdAt: new Date().toISOString(),
    };

    // WORM copy first: if MinIO write fails we do not advance the ledger.
    await this.blobs.putWorm(
      this.config.hashchainBucket,
      `rollups/${hour.replaceAll(':', '-')}.json`,
      Buffer.from(JSON.stringify(entry, null, 2)),
      'application/json',
    );
    await this.ledger.append(entry);
    this.log.info({ hour, root, events: entry.indexCount }, 'hash-chain rollup stored');
    return entry;
  }

  /** Recompute roots from the event store and verify chain linkage + signatures. */
  async verify(fromHour: string, toHour: string): Promise<VerifyResult> {
    const entries = await this.ledger.range(fromHour, toHour);
    const failures: VerifyResult['failures'] = [];
    let prevRoot: string | undefined;
    let prevHour: string | undefined;

    for (const entry of entries) {
      const leaves = await this.events.eventsInHour(entry.hour);
      const recomputed = merkleRoot(leaves.map((l) => ({ id: l.id, contentHash: l.contentHash })));
      if (recomputed !== entry.root) {
        failures.push({ hour: entry.hour, reason: `root mismatch: ledger=${entry.root} recomputed=${recomputed}` });
      }
      if (prevRoot !== undefined && (entry.prevRoot !== prevRoot || entry.prevHour !== prevHour)) {
        failures.push({ hour: entry.hour, reason: 'broken chain linkage (prevRoot/prevHour mismatch)' });
      }
      // A missing hour still linkage-checks (each entry points at the real prior
      // entry), so detect gaps explicitly: consecutive entries must be one hour
      // apart. A gap means an hour of events was never notarised.
      if (prevHour !== undefined && entry.hour !== MerkleChainService.addHour(prevHour)) {
        failures.push({ hour: entry.hour, reason: `gap: no rollup between ${prevHour} and ${entry.hour}` });
      }
      const message = new TextEncoder().encode(`${entry.hour}:${entry.root}:${entry.prevRoot ?? ''}`);
      const valid = await this.signer.verify(message, Buffer.from(entry.sig, 'hex'));
      if (!valid) failures.push({ hour: entry.hour, reason: 'invalid Ed25519 signature' });
      prevRoot = entry.root;
      prevHour = entry.hour;
    }
    return { ok: failures.length === 0, checked: entries.length, failures };
  }
}
