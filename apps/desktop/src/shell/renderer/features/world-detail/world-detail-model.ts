import { formatLocaleDate, formatLocaleDateTime } from '@renderer/i18n';

export type WorldData = {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  type: string;
  status: string;
  level: number;
  creatorId: string | null;
  createdAt: string;
  agentCount: number;
  timeFlowRatio: number;
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
  lore: string | null;
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
    iconUrl: typeof raw.iconUrl === 'string' ? raw.iconUrl : null,
    bannerUrl: typeof raw.bannerUrl === 'string' ? raw.bannerUrl : null,
    type: typeof raw.type === 'string' ? raw.type : 'SUB',
    status: typeof raw.status === 'string' ? raw.status : 'DRAFT',
    level: typeof raw.level === 'number' ? raw.level : 1,
    creatorId: typeof raw.creatorId === 'string' ? raw.creatorId : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    agentCount: typeof raw.agentCount === 'number' ? raw.agentCount : 0,
    timeFlowRatio: typeof raw.timeFlowRatio === 'number' ? raw.timeFlowRatio : 1,
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
    lore: typeof raw.lore === 'string' ? raw.lore : null,
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

export function getWorldInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function getStatusBadgeStyle(status: string): { bg: string; text: string } {
  switch (status) {
    case 'ACTIVE':
      return { bg: 'bg-green-100', text: 'text-green-700' };
    case 'DRAFT':
      return { bg: 'bg-yellow-100', text: 'text-yellow-700' };
    case 'PENDING_REVIEW':
      return { bg: 'bg-blue-100', text: 'text-blue-700' };
    case 'SUSPENDED':
      return { bg: 'bg-red-100', text: 'text-red-700' };
    case 'ARCHIVED':
      return { bg: 'bg-gray-100', text: 'text-gray-600' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-600' };
  }
}

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
