import { useNavigate } from 'react-router';

export interface PivotBarProps {
  source: { host?: string; userId?: string; ip?: string };
  tenantId?: string | undefined;
}

/** One-click pivots from an alert into the Investigate page. */
export default function PivotBar({ source, tenantId }: PivotBarProps): React.JSX.Element {
  const navigate = useNavigate();
  const pivots: Array<{ field: string; value: string; label: string }> = [];
  if (source.ip) pivots.push({ field: 'source.ip', value: source.ip, label: `IP ${source.ip}` });
  if (source.userId) pivots.push({ field: 'user.name', value: source.userId, label: `User ${source.userId}` });
  if (source.host) pivots.push({ field: 'host.name', value: source.host, label: `Host ${source.host}` });
  if (tenantId) pivots.push({ field: 'surf.tenant.id', value: tenantId, label: `Tenant ${tenantId}` });

  if (pivots.length === 0) return <p className="text-sm text-slate-500">No pivotable fields on this alert.</p>;

  return (
    <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label="Pivot to investigation">
      {pivots.map((p) => (
        <button
          key={`${p.field}:${p.value}`}
          type="button"
          className="btn-secondary"
          onClick={() => navigate(`/investigate?field=${encodeURIComponent(p.field)}&value=${encodeURIComponent(p.value)}`)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
