import type { Logger } from 'pino';
import { UpstreamError } from '../../application/errors.js';
import { withSpan } from '../telemetry/otel.js';

export interface ResilienceOptions {
  retries: number;
  baseDelayMs: number;
  /** Circuit opens after this many consecutive 5xx/network failures. */
  failureThreshold: number;
  /** How long the circuit stays open before a half-open probe. */
  resetTimeoutMs: number;
  timeoutMs: number;
}

export const DEFAULT_RESILIENCE: ResilienceOptions = {
  retries: 3,
  baseDelayMs: 250,
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  timeoutMs: 10_000,
};

type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Shared HTTP client for all connectors: named errors, exponential backoff
 * with jitter, per-connector circuit breaker on 5xx/network faults, and an
 * OpenTelemetry span per call.
 */
export class ResilientHttpClient {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(
    private readonly system: string,
    private readonly log: Logger,
    private readonly options: ResilienceOptions = DEFAULT_RESILIENCE,
  ) {}

  async request<T>(url: string, init: RequestInit & { parseAs?: 'json' | 'text' } = {}): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt < this.options.resetTimeoutMs) {
        throw new UpstreamError(this.system, 'circuit open');
      }
      this.state = 'half-open';
      this.log.warn({ system: this.system }, 'circuit half-open, probing upstream');
    }

    return withSpan(`connector.${this.system}`, { url, method: init.method ?? 'GET' }, async () => {
      let lastError: Error | undefined;
      const attempts = this.state === 'half-open' ? 1 : this.options.retries + 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          const response = await fetch(url, {
            ...init,
            signal: AbortSignal.timeout(this.options.timeoutMs),
          });
          if (response.status >= 500) {
            lastError = new Error(`HTTP ${response.status}`);
            this.recordFailure();
            await this.backoff(attempt);
            continue;
          }
          this.recordSuccess();
          if (!response.ok) {
            throw new UpstreamError(this.system, `HTTP ${response.status}: ${await response.text()}`);
          }
          if (init.parseAs === 'text') return (await response.text()) as T;
          if (response.status === 204) return undefined as T;
          return (await response.json()) as T;
        } catch (err) {
          if (err instanceof UpstreamError) throw err;
          lastError = err instanceof Error ? err : new Error(String(err));
          this.recordFailure();
          await this.backoff(attempt);
        }
      }
      throw new UpstreamError(this.system, lastError?.message ?? 'exhausted retries');
    });
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.state !== 'closed') {
      this.log.info({ system: this.system }, 'circuit closed');
      this.state = 'closed';
    }
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.state === 'half-open' || this.consecutiveFailures >= this.options.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
      this.log.error({ system: this.system, failures: this.consecutiveFailures }, 'circuit opened');
    }
  }

  private async backoff(attempt: number): Promise<void> {
    const delay = this.options.baseDelayMs * 2 ** attempt * (0.5 + Math.random());
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
