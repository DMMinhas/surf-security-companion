import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import { VaultTransitSigner } from '../../src/infrastructure/integrations/vaultTransitSigner.js';

/**
 * Exercises the Vault Transit adapter against a fake Vault backed by a real
 * Ed25519 keypair: signing is delegated (fake Vault signs), verification is the
 * adapter's own local public-key check. Proves the wire-format parsing and the
 * auditor-independent verify path without a running Vault.
 */
async function fakeVault(opts: { key: Uint8Array; failSign?: boolean } = { key: new Uint8Array() }): Promise<{
  priv: Uint8Array;
  pub: Uint8Array;
  fetchImpl: typeof fetch;
  signCalls: number;
  keyReadCalls: number;
}> {
  const priv = opts.key.length === 32 ? opts.key : ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const state = { signCalls: 0, keyReadCalls: 0 };

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    if (u.includes('/transit/sign/')) {
      state.signCalls += 1;
      if (opts.failSign) return new Response('permission denied', { status: 403 });
      const input = JSON.parse(String(init?.body ?? '{}')).input as string;
      const msg = new Uint8Array(Buffer.from(input, 'base64'));
      const sig = await ed.signAsync(msg, priv);
      const body = { data: { signature: `vault:v1:${Buffer.from(sig).toString('base64')}` } };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (u.includes('/transit/keys/')) {
      state.keyReadCalls += 1;
      const body = { data: { latest_version: 1, keys: { '1': { public_key: Buffer.from(pub).toString('base64') } } } };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;

  return {
    priv,
    pub,
    fetchImpl,
    get signCalls() {
      return state.signCalls;
    },
    get keyReadCalls() {
      return state.keyReadCalls;
    },
  };
}

function makeSigner(fetchImpl: typeof fetch): VaultTransitSigner {
  return new VaultTransitSigner({
    addr: 'http://vault.test:8200',
    token: 't',
    transitKey: 'surf-hashchain',
    fetchImpl,
  });
}

describe('VaultTransitSigner', () => {
  it('signs via Vault and the signature verifies locally', async () => {
    const vault = await fakeVault();
    const signer = makeSigner(vault.fetchImpl);
    const message = new TextEncoder().encode('2026-07-16T10:00:00Z:rootABC:rootPREV');

    const sig = await signer.sign(message);
    expect(sig).toHaveLength(64); // raw Ed25519 signature
    expect(await signer.verify(message, sig)).toBe(true);
  });

  it('rejects a tampered message or signature', async () => {
    const vault = await fakeVault();
    const signer = makeSigner(vault.fetchImpl);
    const message = new TextEncoder().encode('hour:root:prev');
    const sig = await signer.sign(message);

    expect(await signer.verify(new TextEncoder().encode('hour:TAMPERED:prev'), sig)).toBe(false);
    const bad = Uint8Array.from(sig);
    bad[0] ^= 0xff;
    expect(await signer.verify(message, bad)).toBe(false);
  });

  it('exposes the Vault public key as hex and caches key reads', async () => {
    const vault = await fakeVault();
    const signer = makeSigner(vault.fetchImpl);

    const hex = await signer.publicKeyHex();
    expect(hex).toBe(Buffer.from(vault.pub).toString('hex'));

    await signer.verify(new TextEncoder().encode('x'), new Uint8Array(64));
    expect(vault.keyReadCalls).toBe(1); // public key fetched once, then cached
  });

  it('verification never calls the sign endpoint (auditor-independent)', async () => {
    const vault = await fakeVault();
    const signer = makeSigner(vault.fetchImpl);
    const message = new TextEncoder().encode('m');
    const sig = await signer.sign(message);
    expect(vault.signCalls).toBe(1);

    await signer.verify(message, sig);
    await signer.verify(message, sig);
    expect(vault.signCalls).toBe(1); // verify did not sign again
  });

  it('surfaces a Vault sign failure as an error', async () => {
    const vault = await fakeVault({ key: new Uint8Array(), failSign: true });
    const signer = makeSigner(vault.fetchImpl);
    await expect(signer.sign(new TextEncoder().encode('m'))).rejects.toThrow(/Vault transit sign failed: 403/);
  });

  it('verifies a signature made under an earlier key version after rotation', async () => {
    // Two key versions: v1 signed the historical rollup, v2 is now latest.
    const v1 = ed.utils.randomPrivateKey();
    const v2 = ed.utils.randomPrivateKey();
    const pub1 = await ed.getPublicKeyAsync(v1);
    const pub2 = await ed.getPublicKeyAsync(v2);
    const fetchImpl = (async (url: string | URL): Promise<Response> => {
      if (String(url).includes('/transit/keys/')) {
        const body = {
          data: {
            latest_version: 2,
            keys: {
              '1': { public_key: Buffer.from(pub1).toString('base64') },
              '2': { public_key: Buffer.from(pub2).toString('base64') },
            },
          },
        };
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const signer = makeSigner(fetchImpl);
    const message = new TextEncoder().encode('2026-07-01T10:00:00Z:oldRoot:prevRoot');
    const oldSig = await ed.signAsync(message, v1); // signed under the now-superseded version

    expect(await signer.verify(message, oldSig)).toBe(true); // still verifiable post-rotation
    expect(await signer.publicKeyHex()).toBe(Buffer.from(pub2).toString('hex')); // latest is v2
  });
});
