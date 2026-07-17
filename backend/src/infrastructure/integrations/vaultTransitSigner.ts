import * as ed from '@noble/ed25519';
import type { Signer } from '../../domain/ports/connectors.js';

export interface VaultTransitConfig {
  /** Base address, e.g. http://vault:8200 */
  addr: string;
  /** Vault token with `update` on transit/sign/<key> and `read` on transit/keys/<key>. */
  token: string;
  /** Transit key name, e.g. surf-hashchain. */
  transitKey: string;
  /** Enterprise namespace (optional). */
  namespace?: string;
  /** Transit mount path (default "transit"). */
  mountPath?: string;
  /** Per-request timeout in ms (default 5000) so a hung Vault cannot stall signing. */
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface SignResponse {
  data?: { signature?: string };
}
interface KeyReadResponse {
  data?: { keys?: Record<string, { public_key?: string }>; latest_version?: number };
}

interface TransitKeys {
  /** Public key of the latest version (what auditors publish/display). */
  latest: Uint8Array;
  /** Every non-archived version's public key, so verification survives rotation. */
  all: Uint8Array[];
}

/**
 * Hash-chain signer backed by HashiCorp Vault's Transit engine. The Ed25519
 * private key is generated and held inside Vault and never leaves it — the
 * backend only ever asks Vault to sign, satisfying the "private key never
 * touches the app" requirement (docs/SECRETS.md §5).
 *
 * Verification is deliberately a LOCAL public-key operation: the public keys are
 * fetched from Vault once and cached, then signatures are checked with
 * @noble/ed25519. So chain verification needs neither Vault availability nor the
 * signing token — an external KRITIS auditor can verify tamper-evidence with the
 * published public key alone. The ledger `sig` format (raw Ed25519 hex) is
 * unchanged, so existing rollups stay verifiable.
 *
 * The stored signature carries no key version, so verify() tries every
 * non-archived key version's public key. This keeps historical rollups (signed
 * under an earlier version) verifiable after a Transit key rotation.
 */
export class VaultTransitSigner implements Signer {
  private keysPromise: Promise<TransitKeys> | undefined;
  private readonly mount: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: VaultTransitConfig) {
    this.mount = cfg.mountPath ?? 'transit';
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? 5000;
  }

  private headers(): Record<string, string> {
    return {
      'X-Vault-Token': this.cfg.token,
      'Content-Type': 'application/json',
      ...(this.cfg.namespace ? { 'X-Vault-Namespace': this.cfg.namespace } : {}),
    };
  }

  private async request(url: string, init?: RequestInit): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    const url = `${this.cfg.addr}/v1/${this.mount}/sign/${encodeURIComponent(this.cfg.transitKey)}`;
    const res = await this.request(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ input: Buffer.from(message).toString('base64') }),
    });
    if (!res.ok) {
      throw new Error(`Vault transit sign failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as SignResponse;
    const signature = body.data?.signature;
    if (!signature) throw new Error('Vault transit sign: no signature in response');
    // Format is `vault:v<version>:<base64-signature>`; keep the raw signature bytes.
    const b64 = signature.slice(signature.lastIndexOf(':') + 1);
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  async publicKeyHex(): Promise<string> {
    return Buffer.from((await this.loadKeys()).latest).toString('hex');
  }

  async verify(message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    try {
      const { all } = await this.loadKeys();
      for (const pub of all) {
        if (await ed.verifyAsync(signature, message, pub)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Fetches and caches every Transit key version's public key (32 bytes each). */
  private loadKeys(): Promise<TransitKeys> {
    if (!this.keysPromise) {
      // Cache the in-flight promise so concurrent verifies issue one key read;
      // drop it on failure so a transient Vault error can be retried.
      this.keysPromise = this.fetchKeys().catch((err) => {
        this.keysPromise = undefined;
        throw err;
      });
    }
    return this.keysPromise;
  }

  private async fetchKeys(): Promise<TransitKeys> {
    const url = `${this.cfg.addr}/v1/${this.mount}/keys/${encodeURIComponent(this.cfg.transitKey)}`;
    const res = await this.request(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Vault transit key read failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as KeyReadResponse;
    const versions = body.data?.keys ?? {};
    const all = Object.values(versions)
      .map((v) => v.public_key)
      .filter((p): p is string => typeof p === 'string')
      .map((p) => new Uint8Array(Buffer.from(p, 'base64')));
    const latestVersion = body.data?.latest_version ?? Math.max(0, ...Object.keys(versions).map(Number));
    const latestB64 = versions[String(latestVersion)]?.public_key;
    if (!latestB64 || all.length === 0) {
      throw new Error('Vault transit key read: no public_key for latest version');
    }
    return { latest: new Uint8Array(Buffer.from(latestB64, 'base64')), all };
  }
}
