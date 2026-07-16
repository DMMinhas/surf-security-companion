import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router';
import { claimsOf, completeLogin, currentUser, login } from './lib/oidc';
import { useSession } from './store/session';
import TopNav from './components/TopNav';
import SideNav from './components/SideNav';
import Dashboard from './routes/Dashboard';
import Alerts from './routes/Alerts';
import Investigate from './routes/Investigate';
import Cases from './routes/Cases';
import Playbooks from './routes/Playbooks';
import Rules from './routes/Rules';
import Reports from './routes/Reports';
import Settings from './routes/Settings';

function AuthCallback(): React.JSX.Element {
  const navigate = useNavigate();
  const setClaims = useSession((s) => s.setClaims);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    completeLogin()
      .then((user) => {
        setClaims(claimsOf(user));
        navigate('/dashboard', { replace: true });
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [navigate, setClaims]);

  if (error) {
    return (
      <div role="alert" className="m-8 card border-severity-critical">
        <h1 className="text-lg font-semibold">Login failed</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
        <button type="button" className="btn-primary mt-4" onClick={() => void login()}>
          Retry login
        </button>
      </div>
    );
  }
  return <p className="m-8 text-slate-600">Completing login…</p>;
}

export default function App(): React.JSX.Element {
  const { claims, setClaims } = useSession();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    currentUser()
      .then((user) => {
        if (user && !user.expired) setClaims(claimsOf(user));
      })
      .finally(() => setChecking(false));
  }, [setClaims]);

  if (window.location.pathname === '/auth/callback') {
    return (
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
      </Routes>
    );
  }

  if (checking) return <p className="m-8 text-slate-600">Loading session…</p>;

  if (!claims) {
    return (
      <main className="flex h-full items-center justify-center">
        <div className="card w-96 text-center">
          <h1 className="text-xl font-bold text-brand-700">SURF Security Companion</h1>
          <p className="mt-2 text-sm text-slate-600">
            Security Operations Centre for the SURF flexibility platform. Sign in with your
            federated account (WebAuthn/OTP MFA required).
          </p>
          <button type="button" className="btn-primary mt-6 w-full justify-center" onClick={() => void login()}>
            Sign in with Keycloak
          </button>
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopNav />
      <div className="flex min-h-0 flex-1">
        <SideNav />
        <main id="main" className="min-w-0 flex-1 overflow-y-auto p-6" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/alerts/:id" element={<Alerts />} />
            <Route path="/investigate" element={<Investigate />} />
            <Route path="/cases" element={<Cases />} />
            <Route path="/cases/:id" element={<Cases />} />
            <Route path="/playbooks" element={<Playbooks />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
