import { useMemo } from 'react';

/** Chronological event timeline for the Investigate page. */
export default function InvestigateTimeline({ events }: { events: Array<Record<string, unknown>> }): React.JSX.Element {
  const sorted = useMemo(
    () =>
      [...events].sort((a, b) =>
        String(a['@timestamp'] ?? '').localeCompare(String(b['@timestamp'] ?? '')),
      ),
    [events],
  );

  if (sorted.length === 0) {
    return <p className="text-sm text-slate-500">No events — run a query or pivot from an alert.</p>;
  }

  return (
    <ol className="relative ml-3 space-y-3 border-l-2 border-slate-200 pl-4" aria-label="Event timeline">
      {sorted.map((event, i) => {
        const ts = String(event['@timestamp'] ?? 'unknown');
        const action = String(
          event['event.action'] ?? (event['event'] as Record<string, unknown> | undefined)?.['action'] ?? 'event',
        );
        const product = String(
          event['observer.product'] ?? (event['observer'] as Record<string, unknown> | undefined)?.['product'] ?? '',
        );
        return (
          <li key={i} className="relative">
            <span aria-hidden className="absolute -left-[23px] top-1.5 h-3 w-3 rounded-full bg-brand-500" />
            <p className="text-xs text-slate-500">{ts}</p>
            <p className="text-sm font-medium">
              {action} <span className="font-normal text-slate-500">({product})</span>
            </p>
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-brand-600">raw event</summary>
              <pre className="mt-1 max-w-full overflow-x-auto rounded bg-slate-50 p-2 text-xs">
                {JSON.stringify(event, null, 2)}
              </pre>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
