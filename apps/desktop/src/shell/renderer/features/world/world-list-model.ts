import { isMainWorldType } from './shared';

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

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toComputedAgent(raw: unknown): WorldComputedEntryAgent | null {
  const record = readRecord(raw);
  if (!record?.id) {
    return null;
  }
  return {
    id: String(record.id),
    name: String(record.name || 'Unknown'),
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

function resolveWorldType(raw: Record<string, unknown>): string {
  return (
    readString(raw.type) ??
    readString(raw.worldType) ??
    readString(raw.world_type) ??
    'CREATOR'
  );
}

function resolveCreatorId(raw: Record<string, unknown>): string | null {
  return (
    readString(raw.creatorId) ??
    readString(raw.worldCreatorId) ??
    readString(raw.world_creator_id) ??
    null
  );
}

export function isMainWorld(item: Pick<WorldListItem, 'type' | 'creatorId'>): boolean {
  return isMainWorldType(item.type) || !item.creatorId;
}

export function toWorldListItem(raw: Record<string, unknown>): WorldListItem {
  let parsedAgents: WorldAgentItem[] | undefined;
  if (Array.isArray(raw.agents)) {
    parsedAgents = raw.agents.map((a: unknown) => {
      const agent = a as Record<string, unknown>;
      return {
        id: String(agent.id || ''),
        name: String(agent.name || 'Unknown'),
        handle: typeof agent.handle === 'string' ? agent.handle : undefined,
        bio: typeof agent.bio === 'string' ? agent.bio : undefined,
        avatarUrl: typeof agent.avatarUrl === 'string' ? agent.avatarUrl : null,
        createdAt: typeof agent.createdAt === 'string' ? agent.createdAt : undefined,
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
