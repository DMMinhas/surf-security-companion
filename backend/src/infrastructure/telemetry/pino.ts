import { pino, type Logger } from 'pino';
import type { AppConfig } from '../config.js';
import { secretValues } from '../config.js';

/**
 * Structured JSON logger. Secrets are masked two ways:
 *  - path-based redaction for known credential-bearing keys;
 *  - value-based scrubbing of any configured secret that leaks into a string.
 */
export function createLogger(config: AppConfig): Logger {
  const secrets = secretValues(config);
  return pino({
    level: config.logLevel,
    base: { service: 'surf-security-companion' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.secret',
        '*.token',
        '*.apiKey',
      ],
      censor: '[REDACTED]',
    },
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((a) =>
          typeof a === 'string' ? secrets.reduce((s, secret) => s.replaceAll(secret, '[REDACTED]'), a) : a,
        ) as Parameters<typeof method>;
        method.apply(this, scrubbed);
      },
    },
  });
}
