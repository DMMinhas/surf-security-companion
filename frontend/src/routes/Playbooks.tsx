import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api, playbookRunSchema } from '../lib/api';
import PlaybookRunner from '../components/PlaybookRunner';
import { useSession } from '../store/session';

const runsSchema = z.object({ items: z.array(playbookRunSchema) });

export default function Playbooks(): React.JSX.Element {
  const queryClient = useQueryClient();
  const { claims, hasRole } = useSession();

  const runs = useQuery({
    queryKey: ['playbook-runs'],
    queryFn: () => api('/playbooks/runs?limit=50', { schema: runsSchema }),
    refetchInterval: 10_000,
  });

  const approve = useMutation({
    mutationFn: (runId: string) => api(`/playbooks/${runId}/approve`, { method: 'POST', schema: playbookRunSchema }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['playbook-runs'] }),
  });

  const reject = useMutation({
    mutationFn: ({ runId, reason }: { runId: string; reason: string }) =>
      api(`/playbooks/${runId}/reject`, { method: 'POST', body: { reason }, schema: playbookRunSchema }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['playbook-runs'] }),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">SOAR Playbooks (safe-mode)</h2>
      <p className="text-sm text-slate-600">
        Dry-run is on by default. Real execution needs step-up MFA; mass actions need a second
        PLATFORM_ADMIN (four-eyes). Every step is hash-chained into the audit trail.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <PlaybookRunner playbook="REVOKE_TOKEN" />
        <PlaybookRunner playbook="QUARANTINE_EMS" />
      </div>

      <section aria-labelledby="runs-heading">
        <h3 id="runs-heading" className="text-lg font-semibold">Recent runs</h3>
        {approve.isError && <p role="alert" className="text-sm text-severity-critical">{approve.error.message}</p>}
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Playbook</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Targets</th>
                <th className="px-3 py-2">Dry-run</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Approver</th>
                <th className="px-3 py-2">Four-eyes</th>
              </tr>
            </thead>
            <tbody>
              {(runs.data?.items ?? []).map((run) => (
                <tr key={run.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{new Date(run.ts).toLocaleString()}</td>
                  <td className="px-3 py-2 font-mono text-xs">{run.playbook}</td>
                  <td className="px-3 py-2">{run.actor}</td>
                  <td className="px-3 py-2">{run.targetCount}</td>
                  <td className="px-3 py-2">{run.dryRun ? <span className="badge bg-emerald-100 text-emerald-800">dry</span> : <span className="badge bg-red-100 text-red-800">real</span>}</td>
                  <td className="px-3 py-2">
                    <span className={run.status === 'REQUESTED' ? 'badge bg-amber-100 text-amber-800' : 'badge bg-slate-200 text-slate-700'}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">{run.approver ?? '—'}</td>
                  <td className="px-3 py-2">
                    {run.status === 'REQUESTED' && hasRole('PLATFORM_ADMIN') && run.actor !== claims?.username && (
                      <div className="flex gap-2">
                        <button type="button" className="btn-primary" onClick={() => approve.mutate(run.id)}>Approve</button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            const reason = window.prompt('Rejection reason:');
                            if (reason) reject.mutate({ runId: run.id, reason });
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                    {run.status === 'REQUESTED' && run.actor === claims?.username && (
                      <span className="text-xs text-slate-500">awaiting a second admin</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
