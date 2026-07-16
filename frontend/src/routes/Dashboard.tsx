import { useQuery } from '@tanstack/react-query';
import { api, alertPageSchema } from '../lib/api';
import KpiCharts from '../components/KpiCharts';
import HeatmapCard from '../components/HeatmapCard';
import { Link } from 'react-router';

export default function Dashboard(): React.JSX.Element {
  const alerts = useQuery({
    queryKey: ['alerts', 'dashboard'],
    queryFn: () => api('/alerts?limit=200', { schema: alertPageSchema }),
    refetchInterval: 30_000,
  });

  const items = alerts.data?.items ?? [];
  const open = items.filter((a) => a.status === 'NEW' || a.status === 'ACKNOWLEDGED');
  const critical = items.filter((a) => a.severity === 'critical' && a.status !== 'RESOLVED');

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Dashboard</h2>
      {alerts.isLoading && <p className="text-slate-500">Loading alerts…</p>}
      {alerts.isError && (
        <p role="alert" className="text-severity-critical">
          Failed to load alerts: {alerts.error.message}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Link to="/alerts" className="card block hover:border-brand-500">
          <p className="text-3xl font-bold">{open.length}</p>
          <p className="text-sm text-slate-600">Open alerts</p>
        </Link>
        <Link to="/alerts?severity=critical" className="card block hover:border-brand-500">
          <p className="text-3xl font-bold text-severity-critical">{critical.length}</p>
          <p className="text-sm text-slate-600">Unresolved critical</p>
        </Link>
        <Link to="/cases" className="card block hover:border-brand-500">
          <p className="text-3xl font-bold">{alerts.data?.total ?? 0}</p>
          <p className="text-sm text-slate-600">Alerts (window total)</p>
        </Link>
      </div>
      <KpiCharts alerts={items} />
      <HeatmapCard alerts={items} />
    </div>
  );
}
