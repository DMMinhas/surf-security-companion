import { useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, playbookRunSchema, type PlaybookRun } from '../lib/api';
import { useSession } from '../store/session';
import { stepUp } from '../lib/oidc';

const MASS_ACTION_THRESHOLD = 10; // mirrors PLAYBOOK_MASS_ACTION_THRESHOLD default

export interface PlaybookRunnerProps {
  playbook: 'REVOKE_TOKEN' | 'QUARANTINE_EMS';
}

/**
 * Safe-mode runner: dry-run toggle (default ON), live target count with a
 * mass-action warning, four-eyes indicator, step-up redirect on 403.
 */
export default function PlaybookRunner({ playbook }: PlaybookRunnerProps): React.JSX.Element {
  const [targets, setTargets] = useState('');
  const [reason, setReason] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [reset, setReset] = useState(false);
  const claims = useSession((s) => s.claims);
  const queryClient = useQueryClient();

  const targetList = targets
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const isMass = targetList.length > MASS_ACTION_THRESHOLD;
  const endpoint = playbook === 'REVOKE_TOKEN' ? '/playbooks/revoke-token' : '/playbooks/quarantine-ems';

  const run = useMutation({
    mutationFn: () =>
      api<PlaybookRun>(endpoint, {
        method: 'POST',
        schema: playbookRunSchema,
        body:
          playbook === 'REVOKE_TOKEN'
            ? { tokenIds: targetList, reason, dryRun }
            : { emsIds: targetList, reason, dryRun, reset },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['playbook-runs'] }),
    onError: (err: Error & { code?: string }) => {
      if (err.code === 'STEP_UP_REQUIRED') void stepUp();
    },
  });

  return (
    <form
      className="card space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run.mutate();
      }}
    >
      <h3 className="text-base font-bold">
        {playbook === 'REVOKE_TOKEN' ? 'Revoke API Token' : 'Quarantine EMS'}
      </h3>

      <div>
        <label htmlFor={`${playbook}-targets`} className="block text-sm font-medium">
          {playbook === 'REVOKE_TOKEN' ? 'Token / session ids' : 'EMS device ids'} (comma or newline separated)
        </label>
        <textarea
          id={`${playbook}-targets`}
          className="mt-1 w-full rounded-md border border-slate-300 p-2 font-mono text-sm"
          rows={3}
          value={targets}
          onChange={(e) => setTargets(e.target.value)}
          required
        />
        <p className="mt-1 text-xs text-slate-500">{targetList.length} target(s)</p>
      </div>

      <div>
        <label htmlFor={`${playbook}-reason`} className="block text-sm font-medium">
          Reason (audit-logged)
        </label>
        <input
          id={`${playbook}-reason`}
          className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={3}
          required
        />
      </div>

      <div className="flex items-center gap-3">
        <Switch.Root
          id={`${playbook}-dryrun`}
          checked={dryRun}
          onCheckedChange={setDryRun}
          className="relative h-6 w-11 rounded-full bg-slate-300 data-[state=checked]:bg-emerald-600"
        >
          <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition-transform data-[state=checked]:translate-x-[22px]" />
        </Switch.Root>
        <label htmlFor={`${playbook}-dryrun`} className="text-sm font-medium">
          Dry-run {dryRun ? '(ON — no changes will be made)' : '(OFF — REAL EXECUTION)'}
        </label>
      </div>

      {playbook === 'QUARANTINE_EMS' && (
        <div className="flex items-center gap-2">
          <input id="qe-reset" type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} />
          <label htmlFor="qe-reset" className="text-sm">
            Reset (lift an existing quarantine instead of imposing one)
          </label>
        </div>
      )}

      {!dryRun && (
        <p role="alert" className="rounded-md bg-red-50 p-2 text-sm font-medium text-severity-critical">
          Real execution requires step-up MFA{claims?.mfaVerified ? ' (verified ✓)' : ' — you will be redirected to re-authenticate'}.
        </p>
      )}
      {isMass && !dryRun && (
        <p role="alert" className="rounded-md bg-amber-50 p-2 text-sm font-medium text-amber-800">
          Mass action ({targetList.length} &gt; {MASS_ACTION_THRESHOLD}): this run will require FOUR-EYES approval by a
          second PLATFORM_ADMIN. PagerDuty will page the on-call.
        </p>
      )}

      <button type="submit" className={dryRun ? 'btn-primary' : 'btn-danger'} disabled={run.isPending || targetList.length === 0}>
        {run.isPending ? 'Submitting…' : dryRun ? 'Run (dry-run)' : 'Execute for real'}
      </button>

      {run.isSuccess && (
        <div className="rounded-md bg-emerald-50 p-2 text-sm">
          Run <code>{run.data.id}</code> → <strong>{run.data.status}</strong>
          {run.data.status === 'REQUESTED' && ' — pending four-eyes approval'}
        </div>
      )}
      {run.isError && (
        <p role="alert" className="text-sm text-severity-critical">
          {run.error.message}
        </p>
      )}
    </form>
  );
}
