import type { ReactNode } from 'react';
import type { RuntimePageIdV11 } from './runtime-config-state-types';

export type RuntimeSidebarProps = {
  activePage: RuntimePageIdV11;
  installedModelCount: number;
  activeModelCount: number;
  connectorCount: number;
  healthyConnectorCount: number;
  modCount: number;
  daemonRunning: boolean;
};

export const ICON_CHEVRON_RIGHT = (
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

const ICON_RECOMMEND = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3 2.8 5.67 6.26.91-4.53 4.41 1.07 6.24L12 17.27 6.4 20.23l1.07-6.24L2.94 9.58l6.26-.91L12 3Z" />
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

const ICON_PROFILES = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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

const ICON_DATA_MANAGEMENT = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
);

const ICON_PERFORMANCE = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const ICON_MOD_DEVELOPER = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
  </svg>
);

export const RUNTIME_SIDEBAR_ITEMS: Array<{
  id: RuntimePageIdV11;
  section: 'Core' | 'Connectors' | 'Operations' | 'System';
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
    id: 'recommend',
    section: 'Core',
    label: 'Recommend',
    icon: ICON_RECOMMEND,
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
    id: 'profiles',
    section: 'Operations',
    label: 'AI Profiles',
    icon: ICON_PROFILES,
  },
  {
    id: 'mods',
    section: 'Operations',
    label: 'Mods',
    icon: ICON_MODS,
  },
  {
    id: 'data-management',
    section: 'System',
    label: 'Data Management',
    icon: ICON_DATA_MANAGEMENT,
  },
  {
    id: 'performance',
    section: 'System',
    label: 'Performance',
    icon: ICON_PERFORMANCE,
  },
  {
    id: 'mod-developer',
    section: 'System',
    label: 'Mod Developer',
    icon: ICON_MOD_DEVELOPER,
  },
];

export function getRuntimeSidebarBadge(
  item: (typeof RUNTIME_SIDEBAR_ITEMS)[number],
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
