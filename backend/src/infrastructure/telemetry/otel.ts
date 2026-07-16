import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { trace, type Tracer } from '@opentelemetry/api';

/**
 * OpenTelemetry bootstrap. Must be imported before Fastify/pg/undici so the
 * auto-instrumentations can patch them (main.ts imports this module first).
 * Exports via OTLP/HTTP to the collector configured by the standard
 * OTEL_EXPORTER_OTLP_ENDPOINT env var.
 */
let sdk: NodeSDK | undefined;

export function startOtel(): void {
  if (sdk) return;
  sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation is extremely chatty and useless here
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  sdk.start();
}

export async function stopOtel(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
}

export function tracer(): Tracer {
  return trace.getTracer('surf-security-companion');
}

/** Wrap an async operation in a span; records exceptions and status. */
export async function withSpan<T>(name: string, attributes: Record<string, string | number | boolean>, fn: () => Promise<T>): Promise<T> {
  return tracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn();
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: 2, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}
