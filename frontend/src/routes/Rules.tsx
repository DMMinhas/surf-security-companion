import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api, ruleSchema } from '../lib/api';
import RuleTable from '../components/RuleTable';

const rulesSchema = z.object({ items: z.array(ruleSchema) });

export default function Rules(): React.JSX.Element {
  const rules = useQuery({
    queryKey: ['rules'],
    queryFn: () => api('/rules', { schema: rulesSchema }),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Detection Rules</h2>
      <p className="text-sm text-slate-600">
        Source of truth lives in <code>/rules/*.yml</code> (Sigma), compiled to Wazuh at deploy.
        Toggling a rule requires step-up MFA and is audit-logged.
      </p>
      {rules.isLoading && <p className="text-slate-500">Loading rules…</p>}
      {rules.isError && <p role="alert" className="text-severity-critical">{rules.error.message}</p>}
      {rules.data && <RuleTable rules={rules.data.items} />}
    </div>
  );
}
