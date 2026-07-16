import * as Dialog from '@radix-ui/react-dialog';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { api, type Alert } from '../lib/api';
import SeverityBadge from './SeverityBadge';
import PivotBar from './PivotBar';

export interface AlertDetailDrawerProps {
  alert: Alert | null;
  onClose: () => void;
  onStatusChange: (id: string, status: Alert['status']) => void;
}

export default function AlertDetailDrawer({ alert, onClose, onStatusChange }: AlertDetailDrawerProps): React.JSX.Element {
  const correlated = useQuery({
    queryKey: ['alert-correlated', alert?.id],
    queryFn: () => api<{ events: Array<Record<string, unknown>> }>(`/alerts/${alert!.id}/correlated`),
    enabled: alert !== null,
  });

  return (
    <Dialog.Root open={alert !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30" />
        <Dialog.Content asChild aria-describedby={undefined}>
          <motion.aside
            initial={{ x: 480 }}
            animate={{ x: 0 }}
            className="fixed right-0 top-0 h-full w-[480px] overflow-y-auto bg-white p-6 shadow-xl"
          >
            {alert && (
              <>
                <div className="flex items-start justify-between">
                  <Dialog.Title className="text-lg font-bold">{alert.ruleTitle}</Dialog.Title>
                  <Dialog.Close className="btn-secondary" aria-label="Close alert details">
                    ✕
                  </Dialog.Close>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <SeverityBadge severity={alert.severity} />
                  <span className="badge bg-slate-200 text-slate-700">{alert.status}</span>
                  {alert.tenantId && <span className="badge bg-brand-100 text-brand-700">{alert.tenantId}</span>}
                  <span className="text-xs text-slate-500">seen ×{alert.count}</span>
                </div>
                <p className="mt-4 text-sm text-slate-600">{alert.description}</p>

                <h3 className="mt-6 text-sm font-semibold">MITRE ATT&CK</h3>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(alert.attack.enterprise ?? []).map((t) => (
                    <a
                      key={t}
                      className="badge bg-slate-100 text-slate-700 underline"
                      href={`https://attack.mitre.org/techniques/${t.replace('.', '/')}/`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t}
                    </a>
                  ))}
                  {(alert.attack.ics ?? []).map((t) => (
                    <a
                      key={t}
                      className="badge bg-slate-100 text-slate-700 underline"
                      href={`https://attack.mitre.org/techniques/ics/${t}/`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ICS {t}
                    </a>
                  ))}
                </div>

                <h3 className="mt-6 text-sm font-semibold">Pivot</h3>
                <PivotBar source={alert.source} tenantId={alert.tenantId} />

                <h3 className="mt-6 text-sm font-semibold">Correlated events ({alert.correlatedEventIds.length})</h3>
                {correlated.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
                <ul className="mt-1 max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
                  {(correlated.data?.events ?? []).map((event, i) => (
                    <li key={i} className="rounded bg-slate-50 p-2">
                      {JSON.stringify(event, null, 0).slice(0, 400)}
                    </li>
                  ))}
                </ul>

                <h3 className="mt-6 text-sm font-semibold">Actions</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(['ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'FALSE_POSITIVE', 'ESCALATED'] as const).map((s) => (
                    <button key={s} type="button" className="btn-secondary" onClick={() => onStatusChange(alert.id, s)}>
                      {s.replaceAll('_', ' ')}
                    </button>
                  ))}
                </div>
              </>
            )}
          </motion.aside>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
