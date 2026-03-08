import type { ReactNode } from 'react';
import type { RuntimePageIdV11 } from '../runtime-config-state-types';

type RuntimeSidebarProps = {
  activePage: RuntimePageIdV11;
  onSelectPage: (pageId: RuntimePageIdV11) => void;
  installedModelCount: number;
  activeModelCount: number;
  connectorCount: number;
  healthyConnectorCount: number;
  modCount: number;
  daemonRunning: boolean;
};

const ICON_CHEVRON_RIGHT = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const ICON_OVERVIEW = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
);

const ICON_LOCAL_MODELS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
    <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </svg>
);

const ICON_CLOUD = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.5 19a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 6.2 8.2 4 4 0 0 0 6 16h11.5z" />
  </svg>
);

const ICON_RUNTIME = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33" />
    <path d="M4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.3l.06.06A1.65 1.65 0 0 0 8.92 4" />
    <path d="M9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 4.3 16.96l.06-.06A1.65 1.65 0 0 0 4 15.08" />
    <path d="M15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06A2 2 0 1 1 19.7 7.04l-.06.06A1.65 1.65 0 0 0 20 8.92" />
  </svg>
);

const ICON_MODS = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 7h7" />
    <path d="M14 12h7" />
    <path d="M14 17h7" />
    <path d="M3 7h.01" />
    <path d="M3 12h.01" />
    <path d="M3 17h.01" />
    <path d="M6 7h4" />
    <path d="M6 12h4" />
    <path d="M6 17h4" />
  </svg>
);

const SIDEBAR_ITEMS: Array<{
  id: RuntimePageIdV11;
  section: 'Core' | 'Connectors' | 'Operations';
  label: string;
  icon: ReactNode;
}> = [
  {
    id: 'overview',
    section: 'Core',
    label: 'Overview',
    icon: ICON_OVERVIEW,
  },
  {
    id: 'local',
    section: 'Core',
    label: 'Local Models',
    icon: ICON_LOCAL_MODELS,
  },
  {
    id: 'cloud',
    section: 'Connectors',
    label: 'Cloud API',
    icon: ICON_CLOUD,
  },
  {
    id: 'catalog',
    section: 'Connectors',
    label: 'Catalog',
    icon: ICON_CLOUD,
  },
  {
    id: 'runtime',
    section: 'Operations',
    label: 'Runtime',
    icon: ICON_RUNTIME,
  },
  {
    id: 'mods',
    section: 'Operations',
    label: 'Mods',
    icon: ICON_MODS,
  },
];

function getBadge(
  item: (typeof SIDEBAR_ITEMS)[number],
  props: RuntimeSidebarProps,
): string | null {
  if (item.id === 'local') {
    return `${props.activeModelCount}/${props.installedModelCount}`;
  }
  if (item.id === 'cloud') {
    return `${props.healthyConnectorCount}/${props.connectorCount}`;
  }
  if (item.id === 'mods' && props.modCount > 0) {
    return String(props.modCount);
  }
  return null;
}

export function RuntimeSidebar(props: RuntimeSidebarProps) {
  return (
    <nav className="flex flex-col gap-0.5 px-3 pt-2">
      {SIDEBAR_ITEMS.map((item) => {
        const active = item.id === props.activePage;
        const badge = getBadge(item, props);
        const showDaemonDot = item.id === 'runtime';
        return (
          <button
            key={`sidebar-${item.id}`}
            type="button"
            onClick={() => props.onSelectPage(item.id)}
            className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-sm transition-colors ${
              active ? 'bg-mint-50 font-medium text-mint-700' : 'text-gray-600 hover:bg-mint-50/50'
            }`}
          >
            <span className={active ? 'text-mint-600' : 'text-gray-400'}>{item.icon}</span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {showDaemonDot ? (
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  props.daemonRunning ? 'bg-emerald-500' : 'bg-red-400'
                }`}
              />
            ) : null}
            {badge ? (
              <span
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                  active ? 'bg-mint-100 text-mint-800' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {badge}
              </span>
            ) : null}
            {active ? <span className="ml-0.5 shrink-0 text-mint-600">{ICON_CHEVRON_RIGHT}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
