import { describe, it, expect } from 'vitest';
import { convertRule, type SigmaDoc } from '../../../scripts/convert-sigma.js';

/**
 * The compiled Wazuh field patterns are PCRE2, so Sigma match values must have
 * their regex metacharacters escaped — otherwise a value like an IP or version
 * over-matches (each "." matches any char), which on a negate="yes" field
 * silently suppresses alerts, and "(" / "+" produce invalid PCRE2.
 */
function doc(selection: Record<string, unknown>): SigmaDoc {
  return {
    id: 'de305d54-75b4-431b-adb2-eb6b9e546014',
    title: 'escaping test',
    description: 'x',
    level: 'high',
    tags: ['attack.t1078'],
    logsource: { product: 'pgaudit' },
    detection: { selection, condition: 'selection' },
  };
}

describe('convert-sigma PCRE2 escaping', () => {
  it('escapes dots in an IP value so it matches literally, not as any-char', () => {
    const xml = convertRule(doc({ 'source.ip': '10.0.4.12' }), 100100);
    expect(xml).toContain('^(?:10\\.0\\.4\\.12)$'); // dots escaped
    expect(xml).not.toContain('^(?:10.0.4.12)$'); // never the over-matching form
  });

  it('escapes parentheses/plus so the emitted PCRE2 is valid', () => {
    const xml = convertRule(doc({ 'process.command_line': 'a(b)+c' }), 100100);
    expect(xml).toContain('a\\(b\\)\\+c');
    // every emitted field pattern must be a compilable regex
    for (const m of xml.matchAll(/type="pcre2"[^>]*>(.*?)<\/field>/g)) {
      expect(() => new RegExp(m[1]!.replaceAll('&amp;', '&'))).not.toThrow();
    }
  });
});
