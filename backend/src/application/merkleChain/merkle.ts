import { createHash } from 'node:crypto';

/**
 * Minimal RFC-6962-style Merkle tree over (event_id, content_hash) leaves.
 * Leaf hash:  sha256(0x00 || `${id}:${contentHash}`)
 * Node hash:  sha256(0x01 || left || right)
 * Odd node at a level is promoted unchanged (Bitcoin-style duplication is
 * deliberately avoided to keep proofs unambiguous).
 */

export interface MerkleLeaf {
  id: string;
  contentHash: string;
}

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

export function hashLeaf(leaf: MerkleLeaf): Buffer {
  return createHash('sha256')
    .update(LEAF_PREFIX)
    .update(`${leaf.id}:${leaf.contentHash}`)
    .digest();
}

function hashNode(left: Buffer, right: Buffer): Buffer {
  return createHash('sha256').update(NODE_PREFIX).update(left).update(right).digest();
}

/** Root of an empty set is sha256 of the empty string — a stable sentinel. */
export const EMPTY_ROOT = createHash('sha256').update('').digest('hex');

export function merkleRoot(leaves: MerkleLeaf[]): string {
  if (leaves.length === 0) return EMPTY_ROOT;
  // Deterministic ordering: sort by id so recomputation is stable regardless of scroll order.
  const sorted = [...leaves].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let level: Buffer[] = sorted.map(hashLeaf);
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1];
      if (left === undefined) break;
      next.push(right === undefined ? left : hashNode(left, right));
    }
    level = next;
  }
  const root = level[0];
  if (root === undefined) throw new Error('unreachable: empty merkle level');
  return root.toString('hex');
}

/** Content hash of a raw event document (canonicalised key order). */
export function contentHash(doc: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson(doc)).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}
