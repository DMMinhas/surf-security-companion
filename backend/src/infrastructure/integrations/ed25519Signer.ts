import { readFile } from 'node:fs/promises';
import * as ed from '@noble/ed25519';
import type { Signer } from '../../domain/ports/connectors.js';

/**
 * Soft-key Ed25519 signer for the MVP hash chain. The key file contains the
 * 32-byte private key hex-encoded. Production replaces this class with an
 * HSM/PKCS#11 implementation — see docs/SECRETS.md.
 */
export class FileEd25519Signer implements Signer {
  private privateKey: Uint8Array | undefined;

  constructor(private readonly keyPath: string) {}

  private async key(): Promise<Uint8Array> {
    if (!this.privateKey) {
      const hex = (await readFile(this.keyPath, 'utf8')).trim();
      if (!/^[0-9a-f]{64}$/i.test(hex)) {
        throw new Error(`hash-chain signing key at ${this.keyPath} must be 32 bytes hex`);
      }
      this.privateKey = Uint8Array.from(Buffer.from(hex, 'hex'));
    }
    return this.privateKey;
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return ed.signAsync(message, await this.key());
  }

  async publicKeyHex(): Promise<string> {
    return Buffer.from(await ed.getPublicKeyAsync(await this.key())).toString('hex');
  }

  async verify(message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    try {
      return await ed.verifyAsync(signature, message, await ed.getPublicKeyAsync(await this.key()));
    } catch {
      return false;
    }
  }
}
