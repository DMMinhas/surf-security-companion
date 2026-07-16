import clsx from 'clsx';

const STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-blue-100 text-blue-800',
  info: 'bg-slate-200 text-slate-700',
};

export default function SeverityBadge({ severity }: { severity: string }): React.JSX.Element {
  return (
    <span className={clsx('badge uppercase', STYLES[severity] ?? STYLES['info'])}>
      {severity}
    </span>
  );
}
