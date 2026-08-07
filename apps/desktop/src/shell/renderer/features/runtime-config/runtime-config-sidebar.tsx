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

const ICON_MODEL_MARKET = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l1.7-5h14.6L21 9" />
    <path d="M3 9h18v2a3 3 0 0 1-3 3 3 3 0 0 1-3-3 3 3 0 0 1-3 3 3 3 0 0 1-3-3 3 3 0 0 1-3 3 3 3 0 0 1-3-3V9z" />
    <path d="M5 14v7h14v-7" />
    <path d="M9 21v-4h6v4" />
  </svg>
);

const ICON_LOCAL_AI_CONFIG = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="20" y2="6" />
    <circle cx="9" cy="6" r="2" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <circle cx="15" cy="12" r="2" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="7" cy="18" r="2" />
  </svg>
);

const ICON_MODEL_CATALOG = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
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

/**
 * Runtime sidebar entries. The former single Models section is split
 * into four first-level pages (model market, local models, local AI
 * configurations, model catalog).
 * Developer-only surfaces are NOT ordinary entries — they
 * live in the developer-mode-gated Developer Tools tab.
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
    id: 'modelMarket',
    section: 'Runtime',
    label: 'Model Market',
    icon: ICON_MODEL_MARKET,
  },
  {
    id: 'localModels',
    section: 'Runtime',
    label: 'Local Models',
    icon: ICON_MODELS,
  },
  {
    id: 'localAiConfig',
    section: 'Runtime',
    label: 'Local AI Configurations',
    icon: ICON_LOCAL_AI_CONFIG,
  },
  {
    id: 'modelCatalog',
    section: 'Runtime',
    label: 'Model Catalog',
    icon: ICON_MODEL_CATALOG,
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
];

export function getRuntimeSidebarBadge(
  item: (typeof RUNTIME_SIDEBAR_ITEMS)[number],
  props: RuntimeSidebarProps,
): string | null {
  if (item.id === 'localModels') {
    return `${props.activeModelCount}/${props.installedModelCount}`;
  }
  if (item.id === 'cloud') {
    return `${props.healthyConnectorCount}/${props.connectorCount}`;
  }
  return null;
}
