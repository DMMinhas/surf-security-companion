import * as ed from '@noble/ed25519';
import type { Signer } from '../../domain/ports/connectors.js';

export interface VaultTransitConfig {
  /** Base address, e.g. http://vault:8200 */
  addr: string;
  /** Vault token with `update` on transit/sign/<key>. */
  token: string;
  /** Transit key name, e.g. surf-hashchain. */
  transitKey: string;
  /** Enterprise namespace (optional). */
  namespace?: string;
  /** Transit mount path (default "transit"). */
  mountPath?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface SignResponse {
  data?: { signature?: string };
}
interface KeyReadResponse {
  data?: { keys?: Record<string, { public_key?: string }>; latest_version?: number };
}

/**
 * Hash-chain signer backed by HashiCorp Vault's Transit engine. The Ed25519
 * private key is generated and held inside Vault and never leaves it — the
 * backend only ever asks Vault to sign, satisfying the "private key never
 * touches the app" requirement (docs/SECRETS.md §5).
 *
 * Verification is deliberately a LOCAL public-key operation: the public key is
 * fetched from Vault once and cached, then signatures are checked with
 * @noble/ed25519. So chain verification needs neither Vault availability nor the
 * signing token — an external KRITIS auditor can verify tamper-evidence with the
 * published public key alone. The ledger `sig` format (raw Ed25519 hex) is
 * unchanged, so existing rollups stay verifiable.
 */
export class VaultTransitSigner implements Signer {
  private publicKey: Uint8Array | undefined;
  private readonly mount: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: VaultTransitConfig) {
    this.mount = cfg.mountPath ?? 'transit';
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      'X-Vault-Token': this.cfg.token,
      'Content-Type': 'application/json',
      ...(this.cfg.namespace ? { 'X-Vault-Namespace': this.cfg.namespace } : {}),
    };
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    const url = `${this.cfg.addr}/v1/${this.mount}/sign/${encodeURIComponent(this.cfg.transitKey)}`;
    const res = await this.fetchImpl(url, {
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
    return Buffer.from(await this.loadPublicKey()).toString('hex');
  }

  async verify(message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    try {
      return await ed.verifyAsync(signature, message, await this.loadPublicKey());
    } catch {
      return false;
    }
  }

  /** Fetches and caches the current Ed25519 public key from Vault (32 bytes). */
  private async loadPublicKey(): Promise<Uint8Array> {
    if (this.publicKey) return this.publicKey;
    const url = `${this.cfg.addr}/v1/${this.mount}/keys/${encodeURIComponent(this.cfg.transitKey)}`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Vault transit key read failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as KeyReadResponse;
    const versions = body.data?.keys ?? {};
    const latest = body.data?.latest_version ?? Math.max(0, ...Object.keys(versions).map(Number));
    const pub = versions[String(latest)]?.public_key;
    if (!pub) throw new Error('Vault transit key read: no public_key for latest version');
    this.publicKey = new Uint8Array(Buffer.from(pub, 'base64'));
    return this.publicKey;
  }
}
