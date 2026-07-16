import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { api, casePageSchema, caseSchema } from '../lib/api';
import CaseDetail from '../components/CaseDetail';
import SeverityBadge from '../components/SeverityBadge';
import { useSession } from '../store/session';

export default function Cases(): React.JSX.Element {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isReadOnly = useSession((s) => s.isReadOnly());
  const [showCreate, setShowCreate] = useState(false);

  const list = useQuery({
    queryKey: ['cases'],
    queryFn: () => api('/cases?limit=100', { schema: casePageSchema }),
    enabled: !id,
  });

  const detail = useQuery({
    queryKey: ['case', id],
    queryFn: () => api(`/cases/${id}`, { schema: caseSchema }),
    enabled: !!id,
  });

  const create = useMutation({
    mutationFn: (body: { title: string; description: string; severity: string; significantIncident: boolean }) =>
      api('/cases', { method: 'POST', body, schema: caseSchema }),
    onSuccess: (created) => {
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
      navigate(`/cases/${created.id}`);
    },
  });

  if (id) {
    if (detail.isLoading) return <p className="text-slate-500">Loading case…</p>;
    if (detail.isError) return <p role="alert" className="text-severity-critical">{detail.error.message}</p>;
    return (
      <div className="space-y-4">
        <button type="button" className="btn-secondary" onClick={() => navigate('/cases')}>← All cases</button>
        {detail.data && <CaseDetail kase={detail.data} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Cases</h2>
        {!isReadOnly && (
          <button type="button" className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
            New case
          </button>
        )}
      </div>

      {showCreate && (
        <form
          className="card grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            create.mutate({
              title: (form.elements.namedItem('title') as HTMLInputElement).value,
              description: (form.elements.namedItem('description') as HTMLTextAreaElement).value,
              severity: (form.elements.namedItem('severity') as HTMLSelectElement).value,
              significantIncident: (form.elements.namedItem('significant') as HTMLInputElement).checked,
            });
          }}
        >
          <div className="sm:col-span-2">
            <label htmlFor="c-title" className="block text-sm font-medium">Title</label>
            <input id="c-title" name="title" required minLength={3} className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="c-desc" className="block text-sm font-medium">Description</label>
            <textarea id="c-desc" name="description" rows={3} className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm" />
          </div>
          <div>
            <label htmlFor="c-sev" className="block text-sm font-medium">Severity</label>
            <select id="c-sev" name="severity" className="mt-1 rounded-md border border-slate-300 p-2 text-sm">
              {['critical', 'high', 'medium', 'low'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <input id="c-sig" name="significant" type="checkbox" />
            <label htmlFor="c-sig" className="text-sm">NIS2 significant incident (starts 24h clock)</label>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary" disabled={create.isPending}>Create case</button>
            {create.isError && <p role="alert" className="mt-2 text-sm text-severity-critical">{create.error.message}</p>}
          </div>
        </form>
      )}

      {list.isError && <p role="alert" className="text-severity-critical">{list.error.message}</p>}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Tenant</th>
              <th className="px-3 py-2">Alerts</th>
              <th className="px-3 py-2">NIS2</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.items ?? []).map((c) => (
              <tr key={c.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => navigate(`/cases/${c.id}`)}>
                <td className="px-3 py-2">{new Date(c.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2 font-medium">{c.title}</td>
                <td className="px-3 py-2"><SeverityBadge severity={c.severity} /></td>
                <td className="px-3 py-2">{c.status}</td>
                <td className="px-3 py-2">{c.tenantId ?? '—'}</td>
                <td className="px-3 py-2">{c.alerts.length}</td>
                <td className="px-3 py-2">
                  {c.significantIncidentAt ? <span className="badge bg-red-100 text-red-800">clock running</span> : '—'}
                </td>
              </tr>
            ))}
            {list.data?.items.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No cases yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
