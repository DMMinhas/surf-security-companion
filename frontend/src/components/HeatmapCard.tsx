import { useMemo } from 'react';
import clsx from 'clsx';
import type { Alert } from '../lib/api';

/** 24h × severity heatmap of alert volume for the dashboard. */
export default function HeatmapCard({ alerts }: { alerts: Alert[] }): React.JSX.Element {
  const grid = useMemo(() => {
    const severities = ['critical', 'high', 'medium', 'low', 'info'] as const;
    const counts = new Map<string, number>();
    for (const alert of alerts) {
      const hour = new Date(alert.ts).getHours();
      const key = `${alert.severity}:${hour}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const max = Math.max(1, ...counts.values());
    return severities.map((severity) => ({
      severity,
      hours: Array.from({ length: 24 }, (_, hour) => {
        const count = counts.get(`${severity}:${hour}`) ?? 0;
        return { hour, count, intensity: count / max };
      }),
    }));
  }, [alerts]);

  return (
    <figure className="card" aria-label="Alert volume heatmap by hour and severity">
      <figcaption className="mb-2 text-sm font-semibold">Alert heatmap (hour of day × severity)</figcaption>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-xs" role="grid">
          <tbody>
            {grid.map((row) => (
              <tr key={row.severity}>
                <th scope="row" className="pr-2 text-right font-medium capitalize">
                  {row.severity}
                </th>
                {row.hours.map((cell) => (
                  <td
                    key={cell.hour}
                    role="gridcell"
                    aria-label={`${row.severity} at ${cell.hour}:00 — ${cell.count} alerts`}
                    title={`${cell.count} alerts at ${String(cell.hour).padStart(2, '0')}:00`}
                    className={clsx('h-5 w-5 rounded-sm', cell.count === 0 ? 'bg-slate-100' : 'bg-brand-600')}
                    style={cell.count > 0 ? { opacity: 0.3 + 0.7 * cell.intensity } : undefined}
                  />
                ))}
              </tr>
            ))}
            <tr aria-hidden>
              <td />
              {Array.from({ length: 24 }, (_, h) => (
                <td key={h} className="pt-1 text-center text-[10px] text-slate-400">
                  {h % 6 === 0 ? h : ''}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </figure>
  );
}
