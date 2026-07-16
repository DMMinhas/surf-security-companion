import { logout } from '../lib/oidc';
import { useSession } from '../store/session';

const ROLE_LABELS: Record<string, string> = {
  SOC_ANALYST: 'SOC Analyst',
  DSO_OPERATOR: 'DSO Operator',
  PLATFORM_ADMIN: 'Platform Admin',
  AUDITOR: 'Auditor',
  EXECUTIVE_OBSERVER: 'Executive Observer',
};

export default function TopNav(): React.JSX.Element {
  const claims = useSession((s) => s.claims);

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:bg-white focus:p-2">
        Skip to content
      </a>
      <div className="flex items-center gap-3">
        <img src="/surf-logo.svg" alt="" aria-hidden className="h-9 w-auto" />
        <div>
          <h1 className="text-base font-bold leading-tight text-brand-900">SURF Security Companion</h1>
          <p className="text-xs text-slate-500">KRITIS SOC Portal</p>
        </div>
      </div>
      {claims && (
        <div className="flex items-center gap-4">
          {claims.tenantId && (
            <span className="badge bg-brand-100 text-brand-700" title="Your views are scoped to this tenant">
              Tenant: {claims.tenantId}
            </span>
          )}
          {!claims.mfaVerified && (
            <span className="badge bg-amber-100 text-amber-800" title="Privileged actions require step-up MFA">
              Step-up not verified
            </span>
          )}
          <div className="text-right">
            <p className="text-sm font-medium">{claims.username}</p>
            <p className="text-xs text-slate-500">{claims.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ')}</p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
