import type { ReactNode } from 'react';
import type { RuntimePageIdV11 } from './runtime-config-state-types';

export type RuntimeSidebarProps = {
  activePage: RuntimePageIdV11;
  installedModelCount: number;
  activeModelCount: number;
  connectorCount: number;
  healthyConnectorCount: number;
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

const ICON_PROFILES = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const ICON_MODELS = (
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

const ICON_ENVIRONMENT = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="8" rx="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" />
    <line x1="6" y1="6" x2="6.01" y2="6" />
    <line x1="6" y1="18" x2="6.01" y2="18" />
  </svg>
);

const ICON_ADVANCED = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33" />
    <path d="M4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.3l.06.06A1.65 1.65 0 0 0 8.92 4" />
    <path d="M9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 4.3 16.96l.06-.06A1.65 1.65 0 0 0 4 15.08" />
    <path d="M15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06A2 2 0 1 1 19.7 7.04l-.06.06A1.65 1.65 0 0 0 20 8.92" />
  </svg>
);

/**
 * Canonical six-section Runtime IA (product manual "Runtime / AI Environment").
 * Developer-only surfaces are NOT ordinary entries — they
 * live behind admitted developer mode inside the Advanced section.
 */
export const RUNTIME_SIDEBAR_ITEMS: Array<{
  id: RuntimePageIdV11;
  section: 'Runtime';
  label: string;
  icon: ReactNode;
}> = [
  {
    id: 'overview',
    section: 'Runtime',
    label: 'Overview',
    icon: ICON_OVERVIEW,
  },
  {
    id: 'profiles',
    section: 'Runtime',
    label: 'Profiles',
    icon: ICON_PROFILES,
  },
  {
    id: 'models',
    section: 'Runtime',
    label: 'Models',
    icon: ICON_MODELS,
  },
  {
    id: 'cloud',
    section: 'Runtime',
    label: 'Cloud Connectors',
    icon: ICON_CLOUD,
  },
  {
    id: 'environment',
    section: 'Runtime',
    label: 'Environment',
    icon: ICON_ENVIRONMENT,
  },
  {
    id: 'advanced',
    section: 'Runtime',
    label: 'Advanced',
    icon: ICON_ADVANCED,
  },
];

export function getRuntimeSidebarBadge(
  item: (typeof RUNTIME_SIDEBAR_ITEMS)[number],
  props: RuntimeSidebarProps,
): string | null {
  if (item.id === 'models') {
    return `${props.activeModelCount}/${props.installedModelCount}`;
  }
  if (item.id === 'cloud') {
    return `${props.healthyConnectorCount}/${props.connectorCount}`;
  }
  return null;
}
