import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Alert } from '../lib/api';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#b91c1c',
  high: '#c2570a',
  medium: '#a16207',
  low: '#1d4ed8',
  info: '#4b5563',
};

/** Dashboard KPI charts: alerts by severity and top firing rules. */
export default function KpiCharts({ alerts }: { alerts: Alert[] }): React.JSX.Element {
  const bySeverity = Object.entries(
    alerts.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.severity]: (acc[a.severity] ?? 0) + 1 }), {}),
  ).map(([severity, count]) => ({ severity, count }));

  const byRule = Object.entries(
    alerts.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.ruleTitle]: (acc[a.ruleTitle] ?? 0) + 1 }), {}),
  )
    .map(([rule, count]) => ({ rule: rule.length > 32 ? `${rule.slice(0, 32)}…` : rule, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <figure className="card" aria-label="Alerts by severity">
        <figcaption className="mb-2 text-sm font-semibold">Alerts by severity (current filter)</figcaption>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={bySeverity}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="severity" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" name="Alerts">
              {bySeverity.map((entry) => (
                <Cell key={entry.severity} fill={SEVERITY_COLORS[entry.severity] ?? '#4b5563'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </figure>
      <figure className="card" aria-label="Top firing rules">
        <figcaption className="mb-2 text-sm font-semibold">Top firing rules</figcaption>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={byRule} layout="vertical" margin={{ left: 120 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="rule" width={200} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="count" name="Alerts" fill="#1466b8" />
          </BarChart>
        </ResponsiveContainer>
      </figure>
    </div>
  );
}
