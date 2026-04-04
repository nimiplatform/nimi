import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAppStore } from './app-store.js';

const navItems = [
  { to: '/timeline', label: 'Timeline', icon: 'T' },
  { to: '/profile', label: 'Profile', icon: 'P' },
  { to: '/journal', label: 'Journal', icon: 'J' },
  { to: '/advisor', label: 'Advisor', icon: 'A' },
  { to: '/reports', label: 'Reports', icon: 'R' },
  { to: '/settings', label: 'Settings', icon: 'S' },
] as const;

export function ShellLayout({ children }: { children: ReactNode }) {
  const { children: childList, activeChildId, setActiveChildId } = useAppStore();

  return (
    <div className="flex h-full">
      <nav className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-gray-50 px-3 pt-12">
        <div className="mb-6 px-3">
          <h1 className="text-lg font-semibold text-gray-900">ParentOS</h1>
          <p className="mt-0.5 text-xs text-gray-500">成长底栈</p>
        </div>

        {childList.length > 1 && (
          <div className="mb-4 px-3">
            <select
              value={activeChildId ?? ''}
              onChange={(event) => setActiveChildId(event.target.value || null)}
              className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm"
            >
              {childList.map((child) => (
                <option key={child.childId} value={child.childId}>
                  {child.displayName}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-indigo-50 font-medium text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-semibold text-gray-500">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
