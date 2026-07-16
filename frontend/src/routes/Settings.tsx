import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSession } from '../store/session';
import { stepUp } from '../lib/oidc';

export default function Settings(): React.JSX.Element {
  const { claims, hasRole } = useSession();

  const hashchain = useQuery({
    queryKey: ['hashchain-verify'],
    queryFn: () => {
      const to = new Date().toISOString();
      const from = new Date(Date.now() - 24 * 3600_000).toISOString();
      return api<{ ok: boolean; checked: number; failures: Array<{ hour: string; reason: string }> }>(
        `/admin/hashchain/verify?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
    },
    enabled: hasRole('PLATFORM_ADMIN', 'AUDITOR'),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Settings</h2>

      <section className="card" aria-labelledby="profile-h">
        <h3 id="profile-h" className="font-semibold">Session</h3>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">User</dt><dd>{claims?.username}</dd>
          <dt className="text-slate-500">Roles</dt><dd>{claims?.roles.join(', ')}</dd>
          <dt className="text-slate-500">Tenant</dt><dd>{claims?.tenantId ?? 'all (cross-tenant role)'}</dd>
          <dt className="text-slate-500">Step-up MFA</dt>
          <dd>
            {claims?.mfaVerified ? 'verified ✓' : (
              <button type="button" className="btn-secondary" onClick={() => void stepUp()}>Verify now</button>
            )}
          </dd>
        </dl>
      </section>

      {hasRole('PLATFORM_ADMIN', 'AUDITOR') && (
        <section className="card" aria-labelledby="hc-h">
          <h3 id="hc-h" className="font-semibold">Hash-chain integrity (last 24 h)</h3>
          {hashchain.isLoading && <p className="text-sm text-slate-500">Verifying…</p>}
          {hashchain.data && (
            <p className={`mt-2 text-sm font-medium ${hashchain.data.ok ? 'text-emerald-700' : 'text-severity-critical'}`}>
              {hashchain.data.ok
                ? `✓ ${hashchain.data.checked} hourly rollups verified clean`
                : `✗ ${hashchain.data.failures.length} failures — see RB-05`}
            </p>
          )}
          {hashchain.data?.failures.map((f) => (
            <p key={f.hour} className="text-xs text-severity-critical">{f.hour}: {f.reason}</p>
          ))}
          {hashchain.isError && <p role="alert" className="text-sm text-severity-critical">{hashchain.error.message}</p>}
        </section>
      )}
    </div>
  );
}
