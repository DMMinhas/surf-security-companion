import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace } from '@opentelemetry/api';

/**
 * Browser-side OpenTelemetry: page loads and API calls become spans, exported
 * OTLP/HTTP to the collector. traceparent is injected on fetch so backend
 * spans join the same trace end-to-end (verified in e2e).
 */
export function initTelemetry(): void {
  const endpoint = import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  const provider = new WebTracerProvider({
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }))],
  });
  provider.register();

  const tracer = trace.getTracer('surf-companion-frontend');
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('/api/')) return originalFetch(input, init);
    return tracer.startActiveSpan(`fetch ${new URL(url, location.origin).pathname}`, async (span) => {
      const ctx = span.spanContext();
      const headers = new Headers(init?.headers);
      headers.set('traceparent', `00-${ctx.traceId}-${ctx.spanId}-01`);
      try {
        const response = await originalFetch(input, { ...init, headers });
        span.setAttribute('http.status_code', response.status);
        return response;
      } catch (err) {
        span.recordException(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        span.end();
      }
    });
  };
}
