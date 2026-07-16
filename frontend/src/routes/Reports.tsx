import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSession } from '../store/session';
import { stepUp } from '../lib/oidc';

export default function Reports(): React.JSX.Element {
  const hasRole = useSession((s) => s.hasRole);
  const [quarter, setQuarter] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
  });
  const [range, setRange] = useState({ from: '', to: '' });
  const [pseudonym, setPseudonym] = useState('');

  const onStepUpError = (err: Error & { code?: string }): void => {
    if (err.code === 'STEP_UP_REQUIRED') void stepUp();
  };

  const kritis = useMutation({
    mutationFn: () => api<{ url: string; hash: string }>('/reports/kritis-quarterly', { method: 'POST', body: { quarter } }),
    onError: onStepUpError,
  });
  const auditExport = useMutation({
    mutationFn: () =>
      api<{ url: string; hash: string; eventCount: number }>('/reports/audit-export', {
        method: 'POST',
        body: { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() },
      }),
    onError: onStepUpError,
  });
  const gdpr = useMutation({
    mutationFn: () => api<{ url: string; count: number }>(`/reports/gdpr/subject/${encodeURIComponent(pseudonym)}`, { method: 'POST' }),
    onError: onStepUpError,
  });
  const erase = useMutation({
    mutationFn: () => api(`/reports/gdpr/erase/${encodeURIComponent(pseudonym)}`, { method: 'POST' }),
    onError: onStepUpError,
  });

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Compliance Reports</h2>
      <p className="text-sm text-slate-600">
        NIS2 incident reports are generated from a case (open a case → NIS2 panel). All exports are
        WORM-stored in MinIO with a hash receipt.
      </p>

      <section className="card space-y-3" aria-labelledby="kritis-h">
        <h3 id="kritis-h" className="font-semibold">KRITIS quarterly export</h3>
        <div className="flex items-end gap-2">
          <div>
            <label htmlFor="r-quarter" className="block text-xs font-medium text-slate-600">Quarter</label>
            <input id="r-quarter" className="rounded-md border border-slate-300 p-1.5 text-sm" value={quarter} onChange={(e) => setQuarter(e.target.value)} pattern="\d{4}-Q[1-4]" />
          </div>
          <button type="button" className="btn-primary" onClick={() => kritis.mutate()} disabled={kritis.isPending}>Generate</button>
        </div>
        {kritis.isSuccess && (
          <p className="text-sm">
            Stored (hash <code>{kritis.data.hash.slice(0, 16)}…</code>) — <a className="text-brand-600 underline" href={kritis.data.url}>download</a>
          </p>
        )}
        {kritis.isError && <p role="alert" className="text-sm text-severity-critical">{kritis.error.message}</p>}
      </section>

      {hasRole('PLATFORM_ADMIN', 'AUDITOR') && (
        <section className="card space-y-3" aria-labelledby="audit-h">
          <h3 id="audit-h" className="font-semibold">Audit export (events + hash-chain ledger)</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="r-from" className="block text-xs font-medium text-slate-600">From</label>
              <input id="r-from" type="datetime-local" className="rounded-md border border-slate-300 p-1.5 text-sm" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            </div>
            <div>
              <label htmlFor="r-to" className="block text-xs font-medium text-slate-600">To</label>
              <input id="r-to" type="datetime-local" className="rounded-md border border-slate-300 p-1.5 text-sm" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </div>
            <button type="button" className="btn-primary" onClick={() => auditExport.mutate()} disabled={!range.from || !range.to || auditExport.isPending}>Export</button>
          </div>
          {auditExport.isSuccess && (
            <p className="text-sm">
              {auditExport.data.eventCount} events — <a className="text-brand-600 underline" href={auditExport.data.url}>download bundle</a>
            </p>
          )}
          {auditExport.isError && <p role="alert" className="text-sm text-severity-critical">{auditExport.error.message}</p>}
        </section>
      )}

      {hasRole('PLATFORM_ADMIN', 'AUDITOR') && (
        <section className="card space-y-3" aria-labelledby="gdpr-h">
          <h3 id="gdpr-h" className="font-semibold">GDPR data-subject request</h3>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor="r-pseudonym" className="block text-xs font-medium text-slate-600">Prosumer pseudonym</label>
              <input id="r-pseudonym" className="w-full max-w-sm rounded-md border border-slate-300 p-1.5 font-mono text-sm" value={pseudonym} onChange={(e) => setPseudonym(e.target.value)} />
            </div>
            <button type="button" className="btn-primary" onClick={() => gdpr.mutate()} disabled={!pseudonym || gdpr.isPending}>Art. 15 access</button>
            <button type="button" className="btn-secondary" onClick={() => erase.mutate()} disabled={!pseudonym || erase.isPending}>Art. 17 erasure flag</button>
          </div>
          {gdpr.isSuccess && (
            <p className="text-sm">{gdpr.data.count} events — <a className="text-brand-600 underline" href={gdpr.data.url}>download export</a></p>
          )}
          {erase.isSuccess && <p className="text-sm text-emerald-700">Erasure flagged; effective at end of statutory retention (Art. 17(3)(b)).</p>}
          {(gdpr.isError || erase.isError) && (
            <p role="alert" className="text-sm text-severity-critical">{(gdpr.error ?? erase.error)?.message}</p>
          )}
        </section>
      )}
    </div>
  );
}
