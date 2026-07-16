import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api } from '../lib/api';
import InvestigateTimeline from '../components/InvestigateTimeline';
import { SURF_FIELDS } from '../lib/ecs';

export default function Investigate(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const [field, setField] = useState('user.name');
  const [value, setValue] = useState('');
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);

  const search = useMutation({
    mutationFn: (input: { field: string; value: string }) =>
      api<{ events: Array<Record<string, unknown>> }>(
        `/investigate/pivot/${encodeURIComponent(input.field)}/${encodeURIComponent(input.value)}`,
      ),
    onSuccess: (data) => setEvents(data.events),
  });

  // Deep-link from PivotBar: /investigate?field=…&value=…
  useEffect(() => {
    const f = searchParams.get('field');
    const v = searchParams.get('value');
    if (f && v) {
      setField(f);
      setValue(v);
      search.mutate({ field: f, value: v });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per deep-link change
  }, [searchParams]);

  const savedQueries = useQuery({
    queryKey: ['saved-queries'],
    queryFn: () => api<{ items: Array<{ id: string; name: string; query: Record<string, unknown> }> }>('/investigate/saved-queries'),
  });

  const save = useMutation({
    mutationFn: () =>
      api('/investigate/saved-queries', {
        method: 'POST',
        body: { name: `${field}=${value}`, query: { term: { [field]: value } } },
      }),
    onSuccess: () => void savedQueries.refetch(),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Investigate</h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (value) search.mutate({ field, value });
        }}
      >
        <div>
          <label htmlFor="inv-field" className="block text-xs font-medium text-slate-600">Field</label>
          <select id="inv-field" className="rounded-md border border-slate-300 p-1.5 text-sm" value={field} onChange={(e) => setField(e.target.value)}>
            {SURF_FIELDS.map((f) => (
              <option key={f.field} value={f.field}>{f.label} ({f.field})</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor="inv-value" className="block text-xs font-medium text-slate-600">Value</label>
          <input id="inv-value" className="w-full max-w-md rounded-md border border-slate-300 p-1.5 font-mono text-sm" value={value} onChange={(e) => setValue(e.target.value)} required />
        </div>
        <button type="submit" className="btn-primary" disabled={search.isPending}>
          {search.isPending ? 'Searching…' : 'Search'}
        </button>
        <button type="button" className="btn-secondary" disabled={!value} onClick={() => save.mutate()}>
          Save query
        </button>
      </form>

      {search.isError && <p role="alert" className="text-severity-critical">{search.error.message}</p>}

      {(savedQueries.data?.items.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Saved queries">
          {savedQueries.data!.items.map((sq) => (
            <button
              key={sq.id}
              type="button"
              className="badge bg-slate-100 text-slate-700 hover:bg-slate-200"
              onClick={() => {
                const term = sq.query['term'] as Record<string, string> | undefined;
                const entry = term ? Object.entries(term)[0] : undefined;
                if (entry) {
                  setField(entry[0]);
                  setValue(entry[1]);
                  search.mutate({ field: entry[0], value: entry[1] });
                }
              }}
            >
              {sq.name}
            </button>
          ))}
        </div>
      )}

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold">Timeline ({events.length} events)</h3>
        <InvestigateTimeline events={events} />
      </div>
    </div>
  );
}
