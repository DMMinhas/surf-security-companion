import { describe, it, expect } from 'vitest';
import { merkleRoot, contentHash, canonicalJson, EMPTY_ROOT } from '../../src/application/merkleChain/merkle.js';

describe('merkle', () => {
  it('empty set yields the stable EMPTY_ROOT sentinel', () => {
    expect(merkleRoot([])).toBe(EMPTY_ROOT);
  });

  it('is deterministic regardless of leaf order', () => {
    const a = merkleRoot([
      { id: '1', contentHash: 'aa' },
      { id: '2', contentHash: 'bb' },
      { id: '3', contentHash: 'cc' },
    ]);
    const b = merkleRoot([
      { id: '3', contentHash: 'cc' },
      { id: '1', contentHash: 'aa' },
      { id: '2', contentHash: 'bb' },
    ]);
    expect(a).toBe(b);
  });

  it('changes when any leaf changes (tamper-evident)', () => {
    const base = merkleRoot([
      { id: '1', contentHash: 'aa' },
      { id: '2', contentHash: 'bb' },
    ]);
    const tampered = merkleRoot([
      { id: '1', contentHash: 'aa' },
      { id: '2', contentHash: 'bZ' },
    ]);
    expect(tampered).not.toBe(base);
  });

  it('handles odd leaf counts by promoting the tail', () => {
    expect(() =>
      merkleRoot([
        { id: '1', contentHash: 'a' },
        { id: '2', contentHash: 'b' },
        { id: '3', contentHash: 'c' },
      ]),
    ).not.toThrow();
  });

  it('canonicalJson is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('contentHash is stable for equal documents', () => {
    expect(contentHash({ x: 1, y: [2, 3] })).toBe(contentHash({ y: [2, 3], x: 1 }));
  });
});
