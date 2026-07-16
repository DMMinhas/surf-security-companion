import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api, alertPageSchema, type Alert } from '../lib/api';
import AlertTable from '../components/AlertTable';
import AlertDetailDrawer from '../components/AlertDetailDrawer';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const STATUSES = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'FALSE_POSITIVE', 'ESCALATED'];

export default function Alerts(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<Alert | null>(null);
  const queryClient = useQueryClient();

  const severity = searchParams.get('severity') ?? '';
  const status = searchParams.get('status') ?? '';
  const q = searchParams.get('q') ?? '';

  const query = useQuery({
    queryKey: ['alerts', severity, status, q],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' });
      if (severity) params.set('severity', severity);
      if (status) params.set('status', status);
      if (q) params.set('q', q);
      return api(`/alerts?${params}`, { schema: alertPageSchema });
    },
    refetchInterval: 15_000,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status: next }: { id: string; status: Alert['status'] }) =>
      api(`/alerts/${id}/status`, { method: 'POST', body: { status: next } }),
    onSuccess: () => {
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const bulk = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/alerts/bulk', { method: 'POST', body }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const updateParam = (key: string, value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Alerts</h2>
      <div className="flex flex-wrap items-end gap-3" role="search">
        <div>
          <label htmlFor="f-severity" className="block text-xs font-medium text-slate-600">Severity</label>
          <select id="f-severity" className="rounded-md border border-slate-300 p-1.5 text-sm" value={severity} onChange={(e) => updateParam('severity', e.target.value)}>
            <option value="">all</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-status" className="block text-xs font-medium text-slate-600">Status</label>
          <select id="f-status" className="rounded-md border border-slate-300 p-1.5 text-sm" value={status} onChange={(e) => updateParam('status', e.target.value)}>
            <option value="">all</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor="f-q" className="block text-xs font-medium text-slate-600">Search</label>
          <input id="f-q" type="search" defaultValue={q} placeholder="rule title or description…" className="w-full max-w-md rounded-md border border-slate-300 p-1.5 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && updateParam('q', e.currentTarget.value)} />
        </div>
      </div>

      {query.isError && <p role="alert" className="text-severity-critical">Failed to load: {query.error.message}</p>}

      <AlertTable
        alerts={query.data?.items ?? []}
        onOpen={setSelected}
        onBulk={(action, ids, extra) => {
          if (action === 'ack') bulk.mutate({ action, ids });
          if (action === 'assign') bulk.mutate({ action, ids, assignee: extra });
          if (action === 'link-case') bulk.mutate({ action, ids, caseId: extra });
        }}
      />

      <AlertDetailDrawer
        alert={selected}
        onClose={() => setSelected(null)}
        onStatusChange={(id, next) => setStatus.mutate({ id, status: next })}
      />
    </div>
  );
}
