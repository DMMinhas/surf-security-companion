import { NavLink } from 'react-router';
import clsx from 'clsx';
import { useSession } from '../store/session';

interface NavItem {
  to: string;
  label: string;
  roles?: string[];
}

const ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/alerts', label: 'Alerts' },
  { to: '/investigate', label: 'Investigate', roles: ['SOC_ANALYST', 'DSO_OPERATOR', 'PLATFORM_ADMIN', 'AUDITOR'] },
  { to: '/cases', label: 'Cases' },
  { to: '/playbooks', label: 'Playbooks', roles: ['SOC_ANALYST', 'PLATFORM_ADMIN'] },
  { to: '/rules', label: 'Rules' },
  { to: '/reports', label: 'Reports', roles: ['SOC_ANALYST', 'DSO_OPERATOR', 'PLATFORM_ADMIN', 'AUDITOR'] },
  { to: '/settings', label: 'Settings' },
];

export default function SideNav(): React.JSX.Element {
  const hasRole = useSession((s) => s.hasRole);

  return (
    <nav aria-label="Primary" className="w-52 shrink-0 border-r border-slate-200 bg-white p-3">
      <ul className="space-y-1">
        {ITEMS.filter((item) => !item.roles || hasRole(...item.roles)).map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                clsx(
                  'block rounded-md px-3 py-2 text-sm font-medium',
                  isActive ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-100',
                )
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
