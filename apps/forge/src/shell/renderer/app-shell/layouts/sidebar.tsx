import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';

type NavItem = {
  to: string;
  labelKey: string;
};

type NavGroup = {
  titleKey: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    titleKey: 'sidebar.create',
    items: [
      { to: '/worlds', labelKey: 'sidebar.worlds' },
      { to: '/agents', labelKey: 'sidebar.agents' },
      { to: '/content/images', labelKey: 'sidebar.content' },
      { to: '/publish/releases', labelKey: 'sidebar.publish' },
    ],
  },
  {
    titleKey: 'sidebar.manage',
    items: [
      { to: '/copyright', labelKey: 'sidebar.copyright' },
      { to: '/revenue', labelKey: 'sidebar.revenue' },
    ],
  },
  {
    titleKey: 'sidebar.extend',
    items: [
      { to: '/templates', labelKey: 'sidebar.templates' },
      { to: '/advisors', labelKey: 'sidebar.advisors' },
      { to: '/analytics', labelKey: 'sidebar.analytics' },
    ],
  },
  {
    titleKey: 'sidebar.settings',
    items: [
      { to: '/settings', labelKey: 'sidebar.settings' },
    ],
  },
];

export function Sidebar() {
  const { t } = useTranslation();
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  return (
    <aside
      className={`flex flex-col border-r border-neutral-800 bg-neutral-900 transition-[width] duration-200 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Title bar drag region */}
      <div className="h-12 flex items-center px-4 shrink-0" data-tauri-drag-region>
        {!collapsed && (
          <span className="text-sm font-semibold text-neutral-300 pl-14">{t('app.name')}</span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.titleKey}>
            {!collapsed && (
              <p className="px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                {t(group.titleKey)}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-1.5 text-sm transition-colors ${
                        isActive
                          ? 'bg-neutral-800 text-white'
                          : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200'
                      }`
                    }
                  >
                    {collapsed ? t(item.labelKey).charAt(0) : t(item.labelKey)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="h-10 flex items-center justify-center border-t border-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors shrink-0"
      >
        <span className="text-sm">{collapsed ? '\u203A' : '\u2039'}</span>
      </button>
    </aside>
  );
}
