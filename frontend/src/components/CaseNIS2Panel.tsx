import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Case } from '../lib/api';
import { useSession } from '../store/session';
import { stepUp } from '../lib/oidc';

interface ReportButton {
  route: 'early-warning' | 'incident' | 'final';
  kind: '24h' | '72h' | '1m';
  label: string;
  deadlineHint: string;
}

const BUTTONS: ReportButton[] = [
  { route: 'early-warning', kind: '24h', label: 'Early Warning (24 h)', deadlineHint: 'Art. 23(4)(a) — within 24 hours' },
  { route: 'incident', kind: '72h', label: 'Incident Notification (72 h)', deadlineHint: 'Art. 23(4)(b) — within 72 hours' },
  { route: 'final', kind: '1m', label: 'Final Report (1 month)', deadlineHint: 'Art. 23(4)(d) — within one month' },
];

/** The three NIS2 report buttons + deadline countdowns + generated-report list. */
export default function CaseNIS2Panel({ kase }: { kase: Case }): React.JSX.Element {
  const queryClient = useQueryClient();
  const claims = useSession((s) => s.claims);

  const generate = useMutation({
    mutationFn: (route: ReportButton['route']) =>
      api<{ url: string; hash: string; deadline: string }>(`/reports/nis2/${route}`, {
        method: 'POST',
        body: { caseId: kase.id },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['case', kase.id] }),
    onError: (err: Error & { code?: string }) => {
      if (err.code === 'STEP_UP_REQUIRED') void stepUp();
    },
  });

  const deadlineFor = (kind: ReportButton['kind']): string | null => {
    if (!kase.significantIncidentAt) return null;
    const base = new Date(kase.significantIncidentAt).getTime();
    const deadline =
      kind === '24h' ? base + 24 * 3600_000 : kind === '72h' ? base + 72 * 3600_000 : new Date(base).setMonth(new Date(base).getMonth() + 1);
    const remaining = deadline - Date.now();
    if (remaining < 0) return 'OVERDUE';
    const hours = Math.floor(remaining / 3600_000);
    return hours > 48 ? `${Math.floor(hours / 24)}d left` : `${hours}h left`;
  };

  return (
    <section aria-labelledby="nis2-heading" className="card">
      <h3 id="nis2-heading" className="text-sm font-bold uppercase tracking-wide text-slate-600">
        NIS2 Reporting
      </h3>
      {!kase.significantIncidentAt && (
        <p className="mt-2 text-sm text-amber-700">
          Case is not yet classified as a significant incident — the statutory clock has not started.
        </p>
      )}
      {!claims?.mfaVerified && (
        <p className="mt-2 text-sm text-amber-700">Report generation requires step-up MFA; you will be redirected.</p>
      )}
      <div className="mt-3 grid gap-2">
        {BUTTONS.map((b) => {
          const countdown = deadlineFor(b.kind);
          return (
            <div key={b.kind} className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={generate.isPending}
                onClick={() => generate.mutate(b.route)}
              >
                {b.label}
              </button>
              <div className="text-right">
                <p className="text-xs text-slate-500">{b.deadlineHint}</p>
                {countdown && (
                  <p className={`text-xs font-semibold ${countdown === 'OVERDUE' ? 'text-severity-critical' : 'text-slate-700'}`}>
                    {countdown}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {generate.isError && (
        <p role="alert" className="mt-2 text-sm text-severity-critical">
          Report generation failed: {generate.error.message}
        </p>
      )}
      {kase.nis2ReportsGenerated.length > 0 && (
        <>
          <h4 className="mt-4 text-xs font-semibold uppercase text-slate-500">Generated reports (WORM-stored)</h4>
          <ul className="mt-1 space-y-1 text-sm">
            {kase.nis2ReportsGenerated.map((r) => (
              <li key={`${r.kind}-${r.ts}`} className="flex items-center justify-between">
                <span>
                  {r.kind} — {new Date(r.ts).toLocaleString()}
                </span>
                <code className="text-xs text-slate-500" title="SHA-256 chained into the audit ledger">
                  {r.hash.slice(0, 16)}…
                </code>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
