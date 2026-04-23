import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Avatar,
  Button,
  SidebarAffordanceBadge,
  SidebarHeader,
  SidebarItem,
  SidebarSection,
  SidebarShell,
  Surface,
} from '@nimiplatform/nimi-kit/ui';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';

type ForgeNavItem = {
  to: string;
  labelKey: string;
  fallbackLabel: string;
  description: string;
  icon: ReactNode;
  badge?: string;
  matchPrefixes?: string[];
};

type ForgeNavGroup = {
  titleKey: string;
  fallbackTitle: string;
  items: ForgeNavItem[];
};

function icon(path: ReactNode) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

const ICONS = {
  workbench: icon(<><path d="M3 7h18" /><path d="M7 3v8" /><path d="M17 3v8" /><rect x="3" y="5" width="18" height="16" rx="3" /></>),
  worlds: icon(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" /></>),
  agents: icon(<><path d="M12 3l7 4v5c0 4.5-2.8 7.6-7 9-4.2-1.4-7-4.5-7-9V7l7-4Z" /><path d="M9.5 11.5h5" /><path d="M12 9v5" /></>),
  content: icon(<><rect x="3" y="4" width="18" height="14" rx="2" /><path d="m7 14 3-3 3 3 4-5 2 3" /><path d="M8.5 8.5h.01" /></>),
  publish: icon(<><path d="M12 3v12" /><path d="m7 8 5-5 5 5" /><rect x="4" y="15" width="16" height="6" rx="2" /></>),
  revenue: icon(<><path d="M12 2v20" /><path d="M17 6.5c0-1.9-2.2-3.5-5-3.5s-5 1.6-5 3.5 2.2 3.5 5 3.5 5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5" /></>),
  templates: icon(<><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="m4 12 8 4 8-4" /><path d="m4 17 8 4 8-4" /></>),
  advisors: icon(<><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7V16a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1.3A7 7 0 0 0 12 2Z" /></>),
  analytics: icon(<><path d="M4 19h16" /><path d="M7 16V9" /><path d="M12 16V5" /><path d="M17 16v-3" /></>),
  settings: icon(<><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.96 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.96a1.7 1.7 0 0 0-.34-1.87L4.2 7.03A2 2 0 0 1 7.03 4.2l.06.06A1.7 1.7 0 0 0 8.96 4.6h.09A1.7 1.7 0 0 0 10.6 3.05V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.04 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06A2 2 0 0 1 19.8 7.03l-.06.06A1.7 1.7 0 0 0 19.4 8.96v.09A1.7 1.7 0 0 0 20.95 10.6H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" /></>),
} as const;

export const FORGE_NAV_GROUPS: ForgeNavGroup[] = [
  {
    titleKey: 'sidebar.create',
    fallbackTitle: 'Create',
    items: [
      {
        to: '/workbench',
        labelKey: 'sidebar.workbench',
        fallbackLabel: 'Workbench',
        description: 'World-first creation hub',
        icon: ICONS.workbench,
        matchPrefixes: ['/', '/workbench'],
      },
      {
        to: '/worlds/library',
        labelKey: 'sidebar.worlds',
        fallbackLabel: 'Worlds',
        description: 'Published and draft worlds',
        icon: ICONS.worlds,
        matchPrefixes: ['/worlds'],
      },
      {
        to: '/agents/library',
        labelKey: 'sidebar.agents',
        fallbackLabel: 'Agents',
        description: 'Master and world-owned agents',
        icon: ICONS.agents,
        matchPrefixes: ['/agents'],
      },
      {
        to: '/content/images',
        labelKey: 'sidebar.content',
        fallbackLabel: 'Content',
        description: 'Image, video, and music tools',
        icon: ICONS.content,
        matchPrefixes: ['/content'],
      },
      {
        to: '/publish/releases',
        labelKey: 'sidebar.publish',
        fallbackLabel: 'Publish',
        description: 'Release and channel operations',
        icon: ICONS.publish,
        matchPrefixes: ['/publish'],
      },
    ],
  },
  {
    titleKey: 'sidebar.manage',
    fallbackTitle: 'Manage',
    items: [
      {
        to: '/revenue',
        labelKey: 'sidebar.revenue',
        fallbackLabel: 'Revenue',
        description: 'Balance and withdrawal ops',
        icon: ICONS.revenue,
        matchPrefixes: ['/revenue'],
      },
      {
        to: '/templates',
        labelKey: 'sidebar.templates',
        fallbackLabel: 'Templates',
        description: 'Marketplace and reusable formats',
        icon: ICONS.templates,
        badge: 'Beta',
        matchPrefixes: ['/templates'],
      },
    ],
  },
  {
    titleKey: 'sidebar.extend',
    fallbackTitle: 'Extend',
    items: [
      {
        to: '/advisors',
        labelKey: 'sidebar.advisors',
        fallbackLabel: 'Advisors',
        description: 'Creator-side AI consultation',
        icon: ICONS.advisors,
        badge: 'Lab',
        matchPrefixes: ['/advisors'],
      },
      {
        to: '/analytics',
        labelKey: 'sidebar.analytics',
        fallbackLabel: 'Analytics',
        description: 'Audience and performance readouts',
        icon: ICONS.analytics,
        badge: 'Lab',
        matchPrefixes: ['/analytics'],
      },
    ],
  },
  {
    titleKey: 'sidebar.manage',
    fallbackTitle: 'Settings',
    items: [
      {
        to: '/settings',
        labelKey: 'sidebar.settings',
        fallbackLabel: 'Settings',
        description: 'Theme, route, and shell preferences',
        icon: ICONS.settings,
        matchPrefixes: ['/settings'],
      },
    ],
  },
];

export function findActiveNavItem(pathname: string): ForgeNavItem {
  const normalizedPath = pathname || '/';
  const allItems = FORGE_NAV_GROUPS.flatMap((group) => group.items);
  return (
    allItems.find((item) =>
      (item.matchPrefixes || [item.to]).some((prefix) =>
        prefix === '/' ? normalizedPath === '/' : normalizedPath.startsWith(prefix),
      ),
    ) || FORGE_NAV_GROUPS[0]!.items[0]!
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const user = useAppStore((s) => s.auth.user);

  const activeItem = findActiveNavItem(location.pathname);

  return (
    <SidebarShell
      width={collapsed ? 92 : 288}
      data-testid="forge:sidebar"
      className="m-3 mr-0 rounded-[24px] border-white/40 bg-[color-mix(in_srgb,var(--nimi-sidebar-canvas)_86%,white)] shadow-[0_18px_50px_rgba(15,23,42,0.08)]"
    >
      <SidebarHeader
        title={
          collapsed ? (
            <div className="flex w-full justify-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-[color-mix(in_srgb,var(--nimi-accent-text)_12%,white)] text-sm font-semibold text-[var(--nimi-accent-text)]">
                NF
              </div>
            </div>
          ) : (
            <div className="flex w-full items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-[color-mix(in_srgb,var(--nimi-accent-text)_12%,white)] text-sm font-semibold text-[var(--nimi-accent-text)]">
                NF
              </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
                  {t('app.name', { defaultValue: 'Nimi Forge' })}
              </p>
                <p className="truncate text-xs text-[var(--nimi-text-muted)]">
                  {activeItem.description}
                </p>
              </div>
            </div>
          )
        }
        className="min-h-[72px] px-3"
      />

      {!collapsed ? (
        <div className="px-3 pb-2">
          <Surface tone="card" material="glass-thin" padding="sm">
            <div className="flex items-center gap-3">
              <Avatar
                src={user?.avatarUrl}
                alt={user?.displayName || 'Forge user'}
                size="md"
                shape="circle"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">
                  {user?.displayName || 'Creator session'}
                </p>
                <p className="truncate text-xs text-[var(--nimi-text-muted)]">
                  {user?.email || 'Forge authoring shell'}
                </p>
              </div>
            </div>
          </Surface>
        </div>
      ) : null}

      <nav className="flex-1 overflow-y-auto px-2 py-1">
        {FORGE_NAV_GROUPS.map((group, index) => (
          <SidebarSection
            key={`${group.titleKey}:${index}`}
            label={collapsed ? undefined : t(group.titleKey, { defaultValue: group.fallbackTitle })}
            className="pb-3"
          >
            {group.items.map((item) => {
              const label = t(item.labelKey, { defaultValue: item.fallbackLabel });
              const isActive = (item.matchPrefixes || [item.to]).some((prefix) =>
                prefix === '/' ? location.pathname === '/' : location.pathname.startsWith(prefix),
              );
              return (
                <SidebarItem
                  key={item.to}
                  kind="nav-row"
                  active={isActive}
                  className="mb-1"
                  icon={item.icon}
                  label={collapsed ? label.charAt(0) : label}
                  description={collapsed ? undefined : item.description}
                  trailing={!collapsed && item.badge ? <SidebarAffordanceBadge>{item.badge}</SidebarAffordanceBadge> : undefined}
                  onClick={() => navigate(item.to)}
                />
              );
            })}
          </SidebarSection>
        ))}
      </nav>

      <div className="px-3 pb-3">
        <Button
          tone="ghost"
          fullWidth
          onClick={toggleSidebar}
          className="justify-center rounded-[14px]"
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </Button>
      </div>
    </SidebarShell>
  );
}
