import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, SidebarHeader, SidebarItem, SidebarSection, SidebarShell } from '@nimiplatform/nimi-ui';
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
      { to: '/workbench', labelKey: 'sidebar.workbench' },
      { to: '/worlds/library', labelKey: 'sidebar.worlds' },
      { to: '/agents/library', labelKey: 'sidebar.agents' },
    ],
  },
  {
    titleKey: 'sidebar.manage',
    items: [
      { to: '/settings', labelKey: 'sidebar.settings' },
    ],
  },
  {
    titleKey: 'sidebar.extend',
    items: [
      { to: '/content/images', labelKey: 'sidebar.content' },
      { to: '/publish/releases', labelKey: 'sidebar.publish' },
    ],
  },
];

export function Sidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  return (
    <SidebarShell
      width={collapsed ? 72 : 240}
      data-testid="forge:sidebar"
      className="rounded-none border-y-0 border-l-0 border-r-1"
    >
      <SidebarHeader
        title={!collapsed ? <span className="pl-12 text-sm font-semibold text-[color:var(--nimi-text-secondary)]">{t('app.name')}</span> : <span />}
        className="min-h-12"
      />
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {NAV_GROUPS.map((group) => (
          <SidebarSection
            key={group.titleKey}
            label={collapsed ? undefined : t(group.titleKey)}
            className="pb-3"
          >
            {group.items.map((item) => (
              <SidebarItem
                key={item.to}
                kind="nav-row"
                active={location.pathname.startsWith(item.to)}
                className="mb-1"
                label={collapsed ? t(item.labelKey).charAt(0) : t(item.labelKey)}
                onClick={() => navigate(item.to)}
              />
            ))}
          </SidebarSection>
        ))}
      </nav>
      <div className="border-t border-[color:var(--nimi-border-subtle)] p-2">
        <Button
          tone="ghost"
          fullWidth
          onClick={toggleSidebar}
          className="justify-center"
        >
          {collapsed ? '\u203A' : '\u2039'}
        </Button>
      </div>
    </SidebarShell>
  );
}
