import { formatLocaleDate, formatLocaleDateTime } from '@renderer/i18n';

export type WorldData = {
  id: string;
  name: string;
  description: string | null;
  genre: string | null;
  themes: string[];
  era: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  type: string;
  status: string;
  level: number;
  creatorId: string | null;
  createdAt: string;
  updatedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  agentCount: number;
  timeFlowRatio: number;
  clockConfig: Record<string, unknown> | null;
  sceneTimeConfig: Record<string, unknown> | null;
  nativeAgentLimit: number;
  transitInLimit: number;
  lorebookEntryLimit: number;
  nativeCreationState: string;
  freezeReason: string | null;
  scores: {
    q: number;
    c: number;
    a: number;
    e: number;
    ewma: number;
  };
  hasWorldview: boolean;
  worldviewLifecycle: string | null;
  worldviewVersion: number | null;
  worldviewModuleCount: number;
  worldviewEventCount: number;
  worldviewSnapshotCount: number;
  latestWorldviewEventAt: string | null;
};

type WorldSemanticInput = {
  worldview?: Record<string, unknown> | null;
  worldviewEvents?: Array<Record<string, unknown>>;
  worldviewSnapshots?: Array<Record<string, unknown>>;
};

function toModuleCount(worldview: Record<string, unknown> | null): number {
  if (!worldview) return 0;
  const excluded = new Set([
    'id',
    'worldId',
    'createdAt',
    'updatedAt',
    'version',
    'lifecycle',
  ]);
  let count = 0;
  for (const [key, value] of Object.entries(worldview)) {
    if (excluded.has(key)) {
      continue;
    }
    if (value && typeof value === 'object') {
      count += 1;
    }
  }
  return count;
}

export function toWorldData(raw: Record<string, unknown>, semantic?: WorldSemanticInput): WorldData {
  const worldview = semantic?.worldview || null;
  const worldviewEvents = Array.isArray(semantic?.worldviewEvents) ? semantic?.worldviewEvents : [];
  const worldviewSnapshots = Array.isArray(semantic?.worldviewSnapshots) ? semantic?.worldviewSnapshots : [];
  const latestWorldviewEventAt = worldviewEvents
    .map((item) => {
      if (typeof item.createdAt === 'string') return item.createdAt;
      if (typeof item.occurredAt === 'string') return item.occurredAt;
      if (typeof item.at === 'string') return item.at;
      return '';
    })
    .filter((item) => item)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

  return {
    id: String(raw.id || ''),
    name: String(raw.name || 'Unknown World'),
    description: typeof raw.description === 'string' ? raw.description : null,
    genre: typeof raw.genre === 'string' ? raw.genre : null,
    themes: Array.isArray(raw.themes) ? raw.themes.filter((t): t is string => typeof t === 'string') : [],
    era: typeof raw.era === 'string' ? raw.era : null,
    iconUrl: typeof raw.iconUrl === 'string' ? raw.iconUrl : null,
    bannerUrl: typeof raw.bannerUrl === 'string' ? raw.bannerUrl : null,
    type: typeof raw.type === 'string' ? raw.type : 'SUB',
    status: typeof raw.status === 'string' ? raw.status : 'DRAFT',
    level: typeof raw.level === 'number' ? raw.level : 1,
    creatorId: typeof raw.creatorId === 'string' ? raw.creatorId : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    reviewedAt: typeof raw.reviewedAt === 'string' ? raw.reviewedAt : null,
    reviewedBy: typeof raw.reviewedBy === 'string' ? raw.reviewedBy : null,
    agentCount: typeof raw.agentCount === 'number' ? raw.agentCount : 0,
    timeFlowRatio: typeof raw.timeFlowRatio === 'number' ? raw.timeFlowRatio : 1,
    clockConfig: raw.clockConfig && typeof raw.clockConfig === 'object' && !Array.isArray(raw.clockConfig)
      ? raw.clockConfig as Record<string, unknown>
      : null,
    sceneTimeConfig: raw.sceneTimeConfig && typeof raw.sceneTimeConfig === 'object' && !Array.isArray(raw.sceneTimeConfig)
      ? raw.sceneTimeConfig as Record<string, unknown>
      : null,
    nativeAgentLimit: typeof raw.nativeAgentLimit === 'number' ? raw.nativeAgentLimit : 2,
    transitInLimit: typeof raw.transitInLimit === 'number' ? raw.transitInLimit : 100,
    lorebookEntryLimit: typeof raw.lorebookEntryLimit === 'number' ? raw.lorebookEntryLimit : 300,
    nativeCreationState: typeof raw.nativeCreationState === 'string' ? raw.nativeCreationState : 'OPEN',
    freezeReason: typeof raw.freezeReason === 'string' ? raw.freezeReason : null,
    scores: {
      q: typeof raw.scoreQ === 'number' ? raw.scoreQ : 0,
      c: typeof raw.scoreC === 'number' ? raw.scoreC : 0,
      a: typeof raw.scoreA === 'number' ? raw.scoreA : 0,
      e: typeof raw.scoreE === 'number' ? raw.scoreE : 0,
      ewma: typeof raw.scoreEwma === 'number' ? raw.scoreEwma : 0,
    },
    hasWorldview: worldview !== null,
    worldviewLifecycle: worldview && typeof worldview.lifecycle === 'string' ? worldview.lifecycle : null,
    worldviewVersion: worldview && typeof worldview.version === 'number'
      ? worldview.version
      : worldview && typeof worldview.version === 'string' && Number.isFinite(Number(worldview.version))
        ? Number(worldview.version)
        : null,
    worldviewModuleCount: toModuleCount(worldview),
    worldviewEventCount: worldviewEvents.length,
    worldviewSnapshotCount: worldviewSnapshots.length,
    latestWorldviewEventAt,
  };
}

export { getWorldInitial, getStatusBadgeStyle } from '../world/shared.js';

export function formatWorldDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  return formatLocaleDate(date, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatWorldDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  const date = new Date(String(dateStr || ''));
  if (Number.isNaN(date.getTime())) return '--';
  return formatLocaleDateTime(date);
}

export function getTransitStatusBadgeStyle(status: string): { bg: string; text: string } {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'COMPLETED') {
    return { bg: 'bg-emerald-100', text: 'text-emerald-700' };
  }
  if (normalized === 'ABANDONED') {
    return { bg: 'bg-rose-100', text: 'text-rose-700' };
  }
  return { bg: 'bg-blue-100', text: 'text-blue-700' };
}
