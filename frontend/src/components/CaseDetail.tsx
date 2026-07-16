import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, caseSchema, type Case } from '../lib/api';
import SeverityBadge from './SeverityBadge';
import CaseNIS2Panel from './CaseNIS2Panel';
import MermaidDiagram from './MermaidDiagram';
import { useSession } from '../store/session';

const NEXT_STATUS: Record<Case['status'], Case['status'][]> = {
  OPEN: ['CONTAINED', 'CLOSED'],
  CONTAINED: ['ERADICATED', 'OPEN'],
  ERADICATED: ['RECOVERED', 'CONTAINED'],
  RECOVERED: ['CLOSED', 'ERADICATED'],
  CLOSED: ['OPEN'],
};

function investigationFlow(kase: Case): string {
  const phases = ['OPEN', 'CONTAINED', 'ERADICATED', 'RECOVERED', 'CLOSED'];
  const idx = phases.indexOf(kase.status);
  return [
    'graph LR',
    ...phases.map((p, i) => `  ${p}["${p}${i <= idx ? ' ✓' : ''}"]`),
    '  OPEN --> CONTAINED --> ERADICATED --> RECOVERED --> CLOSED',
    `  style ${kase.status} fill:#1466b8,color:#fff`,
  ].join('\n');
}

export default function CaseDetail({ kase }: { kase: Case }): React.JSX.Element {
  const queryClient = useQueryClient();
  const isReadOnly = useSession((s) => s.isReadOnly());
  const invalidate = (): void => void queryClient.invalidateQueries({ queryKey: ['case', kase.id] });

  const setStatus = useMutation({
    mutationFn: (status: Case['status']) =>
      api(`/cases/${kase.id}/status`, { method: 'POST', body: { status }, schema: caseSchema }),
    onSuccess: invalidate,
  });

  const classify = useMutation({
    mutationFn: () => api(`/cases/${kase.id}/classify-significant`, { method: 'POST', schema: caseSchema }),
    onSuccess: invalidate,
  });

  const addAction = useMutation({
    mutationFn: (input: { action: string; outcome: string }) =>
      api(`/cases/${kase.id}/actions`, { method: 'POST', body: input, schema: caseSchema }),
    onSuccess: invalidate,
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
      <div className="space-y-4">
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-bold">{kase.title}</h2>
              <p className="mt-1 text-sm text-slate-600">{kase.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <SeverityBadge severity={kase.severity} />
              <span className="badge bg-slate-200 text-slate-700">{kase.status}</span>
            </div>
          </div>
          <div className="mt-4">
            <MermaidDiagram definition={investigationFlow(kase)} />
          </div>
          {!isReadOnly && (
            <div className="mt-4 flex flex-wrap gap-2">
              {NEXT_STATUS[kase.status].map((s) => (
                <button key={s} type="button" className="btn-secondary" onClick={() => setStatus.mutate(s)}>
                  → {s}
                </button>
              ))}
              {!kase.significantIncidentAt && (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => classify.mutate()}
                  title="Starts the statutory NIS2 24h clock (RB-06)"
                >
                  Classify as significant incident
                </button>
              )}
            </div>
          )}
        </div>

        <section className="card" aria-labelledby="case-actions-heading">
          <h3 id="case-actions-heading" className="text-sm font-bold uppercase tracking-wide text-slate-600">
            Action log
          </h3>
          <ol className="mt-2 space-y-2">
            {kase.actions.map((a, i) => (
              <li key={i} className="text-sm">
                <span className="text-xs text-slate-500">{new Date(a.ts).toLocaleString()}</span>{' '}
                <strong>{a.actor}</strong>: {a.action} → {a.outcome}
                {a.notes && <p className="text-xs text-slate-500">{a.notes}</p>}
              </li>
            ))}
          </ol>
          {!isReadOnly && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const action = (form.elements.namedItem('action') as HTMLInputElement).value;
                const outcome = (form.elements.namedItem('outcome') as HTMLInputElement).value;
                addAction.mutate({ action, outcome });
                form.reset();
              }}
            >
              <input name="action" required placeholder="Action taken" className="flex-1 rounded-md border border-slate-300 p-2 text-sm" aria-label="Action taken" />
              <input name="outcome" required placeholder="Outcome" className="flex-1 rounded-md border border-slate-300 p-2 text-sm" aria-label="Outcome" />
              <button type="submit" className="btn-primary">Add</button>
            </form>
          )}
        </section>
      </div>

      <div className="space-y-4">
        <CaseNIS2Panel kase={kase} />
        <section className="card">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">Linked alerts</h3>
          <p className="mt-1 text-sm text-slate-600">{kase.alerts.length} alert(s)</p>
          <h3 className="mt-4 text-sm font-bold uppercase tracking-wide text-slate-600">ATT&CK techniques</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            {kase.attackTechniques.map((t) => (
              <span key={t} className="badge bg-slate-100 text-slate-700">{t}</span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
