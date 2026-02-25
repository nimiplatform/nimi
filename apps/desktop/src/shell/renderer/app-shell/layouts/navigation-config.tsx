import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppTab } from '@renderer/app-shell/providers/app-store';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';

export type NavItem = { id: AppTab | string; label: string; icon: ReactNode };

const ICON_HOME = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const ICON_CHAT = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const ICON_CONTACTS = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const ICON_EXPLORE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </svg>
);

const ICON_RUNTIME = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="9" y="9" width="6" height="6" />
    <path d="M15 2v2M15 20v2M2 15h2M20 15h2M9 2v2M9 20v2M2 9h2M20 9h2" />
  </svg>
);

const ICON_PROFILE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const ICON_SETTINGS = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const ICON_STORE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

const ICON_PUZZLE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.878-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 2c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.878.29.493-.075.84-.505 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.968 1.02z" />
  </svg>
);

const ICON_GLOBE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const ICON_WALLET = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z" />
    <path d="M16 3H6a2 2 0 0 0-2 2v2h12V5a2 2 0 0 0-2-2Z" />
    <circle cx="17.5" cy="13.5" r="1.5" />
  </svg>
);

const ICON_AGENT = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="7" width="16" height="12" rx="2" />
    <path d="M9 11h6M9 15h6" />
    <path d="M12 3v4" />
  </svg>
);

const ICON_FILE_TEXT = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h8M8 17h8M8 9h2" />
  </svg>
);

const ICON_SHIELD = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const ICON_LOGOUT = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const ICON_LOCAL_CHAT = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 14a2 2 0 0 1-2 2H8l-5 5V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <path d="M8 9h8" />
    <path d="M8 13h5" />
  </svg>
);

export function renderShellNavIcon(icon: string): ReactNode {
  const normalized = String(icon || '').trim().toLowerCase();
  if (normalized === 'home') return ICON_HOME;
  if (normalized === 'chat') return ICON_CHAT;
  if (normalized === 'contacts') return ICON_CONTACTS;
  if (normalized === 'explore') return ICON_EXPLORE;
  if (normalized === 'runtime') return ICON_RUNTIME;
  if (normalized === 'profile') return ICON_PROFILE;
  if (normalized === 'settings') return ICON_SETTINGS;
  if (normalized === 'store' || normalized === 'marketplace') return ICON_STORE;
  if (normalized === 'globe' || normalized === 'world-studio') return ICON_GLOBE;
  if (normalized === 'wallet') return ICON_WALLET;
  if (normalized === 'agent' || normalized === 'agents' || normalized === 'my-agents' || normalized === 'bot') return ICON_AGENT;
  if (normalized === 'terms' || normalized === 'file' || normalized === 'document' || normalized === 'terms-of-service') return ICON_FILE_TEXT;
  if (normalized === 'privacy' || normalized === 'shield' || normalized === 'privacy-policy') return ICON_SHIELD;
  if (normalized === 'logout' || normalized === 'log-out') return ICON_LOGOUT;
  if (normalized === 'local-chat') return ICON_LOCAL_CHAT;
  return ICON_PUZZLE;
}

const BASE_CORE_NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: renderShellNavIcon('home') },
  { id: 'chat', label: 'Chat', icon: renderShellNavIcon('chat') },
  { id: 'contacts', label: 'Contacts', icon: renderShellNavIcon('contacts') },
  { id: 'explore', label: 'Explore', icon: renderShellNavIcon('explore') },
  { id: 'runtime', label: 'AI Runtime', icon: renderShellNavIcon('runtime') },
  { id: 'settings', label: 'Settings', icon: renderShellNavIcon('settings') },
];

const BASE_QUICK_NAV_ITEMS: NavItem[] = [
  { id: 'marketplace', label: 'Marketplace', icon: renderShellNavIcon('marketplace') },
];

export function getCoreNavItems(): NavItem[] {
  const flags = getShellFeatureFlags();
  return BASE_CORE_NAV_ITEMS.filter((item) => {
    if (item.id === 'runtime') {
      return flags.enableRuntimeTab;
    }
    return true;
  });
}

export function getQuickNavItems(): NavItem[] {
  const flags = getShellFeatureFlags();
  if (!flags.enableMarketplaceTab) {
    return [];
  }
  return BASE_QUICK_NAV_ITEMS;
}

export function NavLink({
  item,
  active,
  onClick,
  collapsed = false,
  badge,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
  collapsed?: boolean;
  badge?: ReactNode;
}) {
  const { t } = useTranslation();
  const translatedLabel = t(`Navigation.${String(item.id)}`, { defaultValue: item.label });
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? translatedLabel : undefined}
      className={`group relative flex w-full items-center text-sm transition-colors ${
        active ? 'font-medium' : 'text-gray-700'
      } ${collapsed ? 'h-11 justify-center' : 'gap-3 rounded-[10px] px-3 py-2'}`}
    >
      <span 
        className={`relative flex items-center justify-center ${collapsed ? 'h-8 w-8' : ''} transition-all duration-200 ${
          active 
            ? 'text-mint-500' 
            : 'text-gray-400 group-hover:bg-mint-100 group-hover:text-gray-600'
        }`}
        style={{ borderRadius: '10px' }}
      >
        {item.icon}
      </span>
      {collapsed ? null : <span className="flex-1 text-left">{translatedLabel}</span>}
      {collapsed ? null : badge}
      {collapsed && badge ? (
        <span className="absolute right-2 top-2 inline-flex h-2 w-2 rounded-full bg-orange-500" />
      ) : null}
      {collapsed ? (
        <span className="sr-only">{translatedLabel}</span>
      ) : null}
    </button>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.6px] text-gray-500">
      {children}
    </p>
  );
}
