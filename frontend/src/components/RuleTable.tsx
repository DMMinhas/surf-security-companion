import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Rule } from '../lib/api';
import SeverityBadge from './SeverityBadge';
import { useSession } from '../store/session';
import { stepUp } from '../lib/oidc';

/** Rule roster with enable/disable (step-up gated) and firing metadata. */
export default function RuleTable({ rules }: { rules: Rule[] }): React.JSX.Element {
  const queryClient = useQueryClient();
  const hasRole = useSession((s) => s.hasRole);
  const canToggle = hasRole('SOC_ANALYST', 'PLATFORM_ADMIN');

  const toggle = useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) =>
      api(`/rules/${id}/${enable ? 'enable' : 'disable'}`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['rules'] }),
    onError: (err: Error & { code?: string }) => {
      if (err.code === 'STEP_UP_REQUIRED') void stepUp();
    },
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left">
          <tr>
            <th className="px-3 py-2">ID</th>
            <th className="px-3 py-2">Title</th>
            <th className="px-3 py-2">Severity</th>
            <th className="px-3 py-2">ATT&CK</th>
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">Fired (24h)</th>
            <th className="px-3 py-2">Precision</th>
            <th className="px-3 py-2">Compliance</th>
            <th className="px-3 py-2">Enabled</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.id} className="border-t border-slate-100">
              <td className="px-3 py-2 font-mono text-xs">{rule.fileId}</td>
              <td className="px-3 py-2">{rule.title}</td>
              <td className="px-3 py-2">
                <SeverityBadge severity={rule.level === 'informational' ? 'info' : rule.level} />
              </td>
              <td className="px-3 py-2 font-mono text-xs">
                {rule.tags
                  .filter((t) => t.startsWith('attack.') && /t\d{4}/i.test(t))
                  .map((t) => t.replace('attack.', '').toUpperCase())
                  .join(', ')}
              </td>
              <td className="px-3 py-2">{rule.logsource.product ?? '—'}</td>
              <td className="px-3 py-2">{rule.stats?.firingRate24h ?? 0}</td>
              <td className="px-3 py-2">
                {rule.stats?.precision !== null && rule.stats?.precision !== undefined
                  ? `${Math.round(rule.stats.precision * 100)}%`
                  : '—'}
              </td>
              <td className="px-3 py-2 text-xs">{rule.compliance[0] ?? '—'}</td>
              <td className="px-3 py-2">
                <button
                  type="button"
                  className={rule.enabled ? 'badge bg-emerald-100 text-emerald-800' : 'badge bg-slate-200 text-slate-600'}
                  disabled={!canToggle || toggle.isPending}
                  aria-pressed={rule.enabled}
                  title={canToggle ? 'Toggle (requires step-up MFA)' : 'SOC_ANALYST or PLATFORM_ADMIN only'}
                  onClick={() => toggle.mutate({ id: rule.fileId, enable: !rule.enabled })}
                >
                  {rule.enabled ? 'enabled' : 'disabled'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
