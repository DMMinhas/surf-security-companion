import { describe, it, expect } from 'vitest';
import { RuleEvaluator, getField, matchesSelection } from '../../src/correlation/evaluator.js';
import type { SigmaRule } from '../../src/domain/entities/sigmaRule.js';

const evaluator = new RuleEvaluator();

function rule(detection: SigmaRule['detection']): SigmaRule {
  return {
    id: 'x',
    fileId: 'R-99',
    title: 't',
    description: 'd',
    author: 'a',
    date: '2026/07/14',
    references: [],
    level: 'high',
    tags: ['attack.t1110'],
    logsource: {},
    detection,
    falsepositives: [],
    owner: 'x@y',
    compliance: [],
    enabled: true,
  };
}

describe('getField', () => {
  it('reads flat dotted keys', () => {
    expect(getField({ 'a.b': 1 }, 'a.b')).toBe(1);
  });
  it('reads nested objects', () => {
    expect(getField({ a: { b: 2 } }, 'a.b')).toBe(2);
  });
  it('returns undefined for missing paths', () => {
    expect(getField({ a: {} }, 'a.b.c')).toBeUndefined();
  });
});

describe('matchesSelection', () => {
  it('is case-insensitive on string equality', () => {
    expect(matchesSelection({ x: 'FOO' }, { x: { kind: 'equals', value: 'foo' } })).toBe(true);
  });
  it('supports in-lists', () => {
    expect(matchesSelection({ x: 'b' }, { x: { kind: 'in', values: ['a', 'b'] } })).toBe(true);
  });
});

describe('RuleEvaluator', () => {
  it('plain selection matches any qualifying event', () => {
    const r = rule({ selections: { selection: { a: { kind: 'equals', value: 1 } } }, condition: 'selection' });
    expect(evaluator.evaluate(r, [{ a: 1 }, { a: 2 }]).matched).toBe(true);
  });

  it('and-not filter excludes filtered events', () => {
    const r = rule({
      selections: {
        selection: { a: { kind: 'equals', value: 1 } },
        filter: { b: { kind: 'equals', value: true } },
      },
      condition: 'selection and not filter',
    });
    expect(evaluator.evaluate(r, [{ a: 1, b: true }]).matched).toBe(false);
    expect(evaluator.evaluate(r, [{ a: 1, b: false }]).matched).toBe(true);
  });

  it('count() by field crosses threshold per group', () => {
    const r = rule({
      selections: { selection: { a: { kind: 'equals', value: 1 } } },
      condition: 'selection | count() by user > 2',
    });
    const events = [
      { a: 1, user: 'x' },
      { a: 1, user: 'x' },
      { a: 1, user: 'x' },
      { a: 1, user: 'y' },
    ];
    const result = evaluator.evaluate(r, events);
    expect(result.matched).toBe(true);
    expect(result.groups).toContain('x');
    expect(result.groups).not.toContain('y');
  });

  it('distinct count(field) counts unique values', () => {
    const r = rule({
      selections: { selection: { a: { kind: 'equals', value: 1 } } },
      condition: 'selection | count(ip) by user >= 3',
    });
    const sameIp = [
      { a: 1, user: 'x', ip: '1.1.1.1' },
      { a: 1, user: 'x', ip: '1.1.1.1' },
      { a: 1, user: 'x', ip: '1.1.1.1' },
    ];
    expect(evaluator.evaluate(r, sameIp).matched).toBe(false); // only 1 distinct ip
    const threeIps = [
      { a: 1, user: 'x', ip: '1.1.1.1' },
      { a: 1, user: 'x', ip: '2.2.2.2' },
      { a: 1, user: 'x', ip: '3.3.3.3' },
    ];
    expect(evaluator.evaluate(r, threeIps).matched).toBe(true);
  });
});
