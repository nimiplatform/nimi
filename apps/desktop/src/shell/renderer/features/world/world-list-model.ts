import type { WorldTruthListItem } from '@nimiplatform/sdk/world';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { isMainWorldType } from './shared';

type WorldDetailDto = RealmModel<'WorldDetailDto'>;
type WorldDetailWithAgentsDto = RealmModel<'WorldDetailWithAgentsDto'>;
type WorldAgentSummaryDto = RealmModel<'WorldAgentSummaryDto'>;
type LooseObject = { [key: string]: unknown };

export type WorldAgentItem = {
  id: string;
  name: string;
  handle?: string;
  bio?: string;
  avatarUrl?: string | null;
  createdAt?: string;
};

export type WorldComputedTime = {
  currentWorldTime: string | null;
  currentLabel: string | null;
  eraLabel: string | null;
  flowRatio: number;
  isPaused: boolean;
};

export type WorldComputedLanguages = {
  primary: string | null;
  common: string[];
};

export type WorldComputedEntryAgent = {
  id: string;
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
};

export type WorldComputed = {
  time: WorldComputedTime;
  languages: WorldComputedLanguages;
  entry: {
    recommendedAgents: WorldComputedEntryAgent[];
  };
  score: {
    scoreEwma: number;
  };
  featuredAgentCount: number;
};

export type WorldListItem = {
  id: string;
  name: string;
  description: string | null;
  tagline?: string | null;
  motto?: string | null;
  overview?: string | null;
  contentRating?: string | null;
  genre: string | null;
  themes: string[];
  era: string | null;
  iconUrl: string | null;
  bannerUrl: string | null;
  type: string;
  status: string;
  level: number;
  levelUpdatedAt: string | null;
  agentCount: number;
  createdAt: string;
  updatedAt: string | null;
  creatorId: string | null;
  freezeReason: string | null;
  lorebookEntryLimit: number;
  nativeAgentLimit: number;
  nativeCreationState: string;
  scoreA: number;
  scoreC: number;
  scoreE: number;
  scoreEwma: number;
  scoreQ: number;
  transitInLimit: number;
  computed: WorldComputed;
  agents?: WorldAgentItem[];
};

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readRecord(value: unknown): LooseObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as LooseObject) : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toComputedAgent(raw: unknown): WorldComputedEntryAgent | null {
  const record = readRecord(raw);
  if (!record) {
    return null;
  }
  const id = typeof record?.id === 'string' ? record.id : '';
  if (!id) {
    return null;
  }
  return {
    id,
    name: typeof record.name === 'string' ? record.name : 'Unknown',
    handle: readString(record.handle),
    avatarUrl: readString(record.avatarUrl),
  };
}

function toWorldComputed(raw: unknown): WorldComputed {
  const record = readRecord(raw);
  const time = readRecord(record?.time);
  const languages = readRecord(record?.languages);
  const entry = readRecord(record?.entry);
  const score = readRecord(record?.score);

  return {
    time: {
      currentWorldTime: readString(time?.currentWorldTime),
      currentLabel: readString(time?.currentLabel),
      eraLabel: readString(time?.eraLabel),
      flowRatio: Math.max(0.0001, readNumber(time?.flowRatio) ?? 1),
      isPaused: readBoolean(time?.isPaused) ?? false,
    },
    languages: {
      primary: readString(languages?.primary),
      common: Array.isArray(languages?.common)
        ? languages.common.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [],
    },
    entry: {
      recommendedAgents: Array.isArray(entry?.recommendedAgents)
        ? entry.recommendedAgents.map(toComputedAgent).filter((value): value is WorldComputedEntryAgent => Boolean(value))
        : [],
    },
    score: {
      scoreEwma: readNumber(score?.scoreEwma) ?? 0,
    },
    featuredAgentCount: readNumber(record?.featuredAgentCount) ?? 0,
  };
}

function resolveWorldType(raw: WorldDetailDto): string {
  return (
    readString(raw.type) ??
    'CREATOR'
  );
}

function resolveCreatorId(raw: WorldDetailDto): string | null {
  return (
    readString(raw.creatorId) ??
    null
  );
}

export function isMainWorld(item: Pick<WorldListItem, 'type' | 'creatorId'>): boolean {
  return isMainWorldType(item.type) || !item.creatorId;
}

export function toWorldListItemFromTruth(raw: WorldTruthListItem): WorldListItem {
  const computed = raw.computed;
  return {
    id: raw.worldId,
    name: raw.title || 'Unknown World',
    description: raw.description ?? null,
    tagline: raw.tagline ?? null,
    motto: raw.motto ?? null,
    overview: raw.overview ?? null,
    contentRating: raw.contentRating ?? null,
    genre: raw.genre ?? null,
    themes: raw.themes ?? [],
    era: raw.era ?? null,
    iconUrl: raw.iconUrl ?? null,
    bannerUrl: raw.bannerUrl ?? null,
    type: raw.type ?? 'CREATOR',
    status: raw.status ?? 'DRAFT',
    level: raw.level ?? 1,
    levelUpdatedAt: raw.levelUpdatedAt ?? null,
    agentCount: raw.agentCount ?? 0,
    createdAt: raw.createdAt ?? '',
    updatedAt: raw.updatedAt ?? null,
    creatorId: raw.creatorId ?? null,
    freezeReason: raw.freezeReason ?? null,
    lorebookEntryLimit: raw.lorebookEntryLimit ?? 0,
    nativeAgentLimit: raw.nativeAgentLimit ?? 0,
    nativeCreationState: raw.nativeCreationState ?? 'OPEN',
    scoreA: raw.scoreA ?? 0,
    scoreC: raw.scoreC ?? 0,
    scoreE: raw.scoreE ?? 0,
    scoreEwma: raw.scoreEwma ?? computed?.score?.scoreEwma ?? 0,
    scoreQ: raw.scoreQ ?? 0,
    transitInLimit: raw.transitInLimit ?? 0,
    computed: {
      time: {
        currentWorldTime: computed?.time?.currentWorldTime ?? null,
        currentLabel: computed?.time?.currentLabel ?? null,
        eraLabel: computed?.time?.eraLabel ?? null,
        flowRatio: Math.max(0.0001, computed?.time?.flowRatio ?? 1),
        isPaused: computed?.time?.isPaused ?? false,
      },
      languages: {
        primary: computed?.languages?.primary ?? null,
        common: computed?.languages?.common ?? [],
      },
      entry: {
        recommendedAgents: (computed?.entry?.recommendedAgents ?? []).map((agent) => ({
          id: agent.agentId,
          name: agent.name,
          handle: agent.handle ?? null,
          avatarUrl: agent.avatarUrl ?? null,
        })),
      },
      score: {
        scoreEwma: computed?.score?.scoreEwma ?? raw.scoreEwma ?? 0,
      },
      featuredAgentCount: computed?.featuredAgentCount ?? 0,
    },
  };
}

export function toWorldListItem(raw: WorldDetailDto | WorldDetailWithAgentsDto): WorldListItem {
  let parsedAgents: WorldAgentItem[] | undefined;
  if ('agents' in raw && Array.isArray(raw.agents)) {
    parsedAgents = raw.agents.map((agent: WorldAgentSummaryDto) => {
      return {
        id: agent.id,
        name: agent.name || 'Unknown',
        handle: agent.handle,
        bio: agent.bio,
        avatarUrl: agent.avatarUrl ?? null,
        createdAt: agent.createdAt,
      };
    });
  }

  return {
    id: String(raw.id || ''),
    name: String(raw.name || 'Unknown World'),
    description: typeof raw.description === 'string' ? raw.description : null,
    tagline: typeof raw.tagline === 'string' ? raw.tagline : null,
    motto: typeof raw.motto === 'string' ? raw.motto : null,
    overview: typeof raw.overview === 'string' ? raw.overview : null,
    contentRating: typeof raw.contentRating === 'string' ? raw.contentRating : null,
    genre: typeof raw.genre === 'string' ? raw.genre : null,
    themes: Array.isArray(raw.themes)
      ? raw.themes.filter((t): t is string => typeof t === 'string')
      : [],
    era: typeof raw.era === 'string' ? raw.era : null,
    iconUrl: typeof raw.iconUrl === 'string' ? raw.iconUrl : null,
    bannerUrl: typeof raw.bannerUrl === 'string' ? raw.bannerUrl : null,
    type: resolveWorldType(raw),
    status: typeof raw.status === 'string' ? raw.status : 'DRAFT',
    level: typeof raw.level === 'number' ? raw.level : 1,
    levelUpdatedAt: typeof raw.levelUpdatedAt === 'string' ? raw.levelUpdatedAt : null,
    agentCount: typeof raw.agentCount === 'number' ? raw.agentCount : 0,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    creatorId: resolveCreatorId(raw),
    freezeReason: typeof raw.freezeReason === 'string' ? raw.freezeReason : null,
    lorebookEntryLimit: typeof raw.lorebookEntryLimit === 'number' ? raw.lorebookEntryLimit : 0,
    nativeAgentLimit: typeof raw.nativeAgentLimit === 'number' ? raw.nativeAgentLimit : 0,
    nativeCreationState:
      typeof raw.nativeCreationState === 'string' ? raw.nativeCreationState : 'OPEN',
    scoreA: typeof raw.scoreA === 'number' ? raw.scoreA : 0,
    scoreC: typeof raw.scoreC === 'number' ? raw.scoreC : 0,
    scoreE: typeof raw.scoreE === 'number' ? raw.scoreE : 0,
    scoreEwma: typeof raw.scoreEwma === 'number' ? raw.scoreEwma : 0,
    scoreQ: typeof raw.scoreQ === 'number' ? raw.scoreQ : 0,
    transitInLimit: typeof raw.transitInLimit === 'number' ? raw.transitInLimit : 0,
    computed: toWorldComputed(raw.computed),
    agents: parsedAgents,
  };
}
