import type { NimiRealmCoreSourceRef } from '@nimiplatform/sdk/realm';
import { isMainWorldType } from './shared';

type LooseObject = { [key: string]: unknown };
type WorldDetailDto = LooseObject;
type WorldDetailWithCharactersDto = LooseObject & { characters?: WorldCharacterSummaryDto[] };
type WorldCharacterSummaryDto = {
  id: string;
  name?: string;
  handle?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  profileCoverUrl?: string | null;
  createdAt?: string;
  sourceRef?: NimiRealmCoreSourceRef | null;
};

export type WorldCharacterItem = {
  id: string;
  name: string;
  handle?: string;
  bio?: string;
  avatarUrl?: string | null;
  profileCoverUrl?: string | null;
  createdAt?: string;
  sourceRef?: NimiRealmCoreSourceRef | null;
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

export type WorldComputedEntryCharacter = {
  id: string;
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
};

export type WorldComputed = {
  time: WorldComputedTime;
  languages: WorldComputedLanguages;
  entry: {
    recommendedCharacters: WorldComputedEntryCharacter[];
  };
  score: {
    scoreEwma: number;
  };
  featuredCharacterCount: number;
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
  highlightUrls: string[];
  type: string;
  status: string;
  visibility: string | null;
  level: number;
  levelUpdatedAt: string | null;
  characterCount: number;
  personaCount: number;
  sceneCount: number;
  systemCount: number;
  timelineEventCount: number;
  createdAt: string;
  updatedAt: string | null;
  creatorId: string | null;
  freezeReason: string | null;
  scoreA: number;
  scoreC: number;
  scoreE: number;
  scoreEwma: number;
  scoreQ: number;
  computed: WorldComputed;
  characters?: WorldCharacterItem[];
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

function readNamedString(record: LooseObject | null, ...keys: string[]): string | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function readNamedNumber(record: LooseObject | null, ...keys: string[]): number | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = readNumber(record[key]);
    if (value != null) {
      return value;
    }
  }
  return null;
}

function readNamedBoolean(record: LooseObject | null, ...keys: string[]): boolean | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = readBoolean(record[key]);
    if (value != null) {
      return value;
    }
  }
  return null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(readString).filter((item): item is string => Boolean(item))
    : [];
}

function toComputedCharacter(raw: unknown): WorldComputedEntryCharacter | null {
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

function toWorldComputed(raw: unknown, fallbackCharacterCount = 0): WorldComputed {
  const record = readRecord(raw);
  const time = readRecord(record?.time);
  const languages = readRecord(record?.languages);
  const entry = readRecord(record?.entry);
  const score = readRecord(record?.score);

  return {
    time: {
      currentWorldTime: readNamedString(time, 'currentWorldTime'),
      currentLabel: readNamedString(time, 'currentLabel', 'currentWorldTimeDisplay'),
      eraLabel: readNamedString(time, 'eraLabel', 'anchorWorldStartedAtDisplay'),
      flowRatio: Math.max(0.0001, readNamedNumber(time, 'flowRatio') ?? 1),
      isPaused: readNamedBoolean(time, 'isPaused') ?? false,
    },
    languages: {
      primary: readNamedString(languages, 'primary'),
      common: readStringArray(languages?.common),
    },
    entry: {
      recommendedCharacters: Array.isArray(entry?.recommendedCharacters)
        ? entry.recommendedCharacters.map(toComputedCharacter).filter((value): value is WorldComputedEntryCharacter => Boolean(value))
        : [],
    },
    score: {
      scoreEwma: readNamedNumber(score, 'scoreEwma') ?? 0,
    },
    featuredCharacterCount: readNumber(record?.featuredCharacterCount) ?? fallbackCharacterCount,
  };
}

function resolveWorldType(raw: WorldDetailDto): string {
  const type = readString(raw.type);
  if (type === 'OASIS') {
    return 'OASIS';
  }
  return type ?? 'CREATOR';
}

function resolveCreatorId(raw: WorldDetailDto): string | null {
  return (
    readString(raw.creatorId) ??
    null
  );
}

function isPublicWorldDisplayRecord(raw: WorldDetailDto): boolean {
  return Boolean(
    readString(raw.id)
      && readString(raw.name)
      && readString(raw.summary)
      && readRecord(raw.media)
      && readRecord(raw.stats)
      && readRecord(raw.time),
  );
}

function requireWorldDisplayRecord(raw: WorldDetailDto): LooseObject | null {
  if (isPublicWorldDisplayRecord(raw)) {
    return null;
  }
  throw new Error('World list item requires public world product projection');
}

export function isMainWorld(item: Pick<WorldListItem, 'type' | 'creatorId'>): boolean {
  return isMainWorldType(item.type);
}

export function toWorldListItem(raw: WorldDetailDto | WorldDetailWithCharactersDto): WorldListItem {
  requireWorldDisplayRecord(raw);
  const media = readRecord(raw.media);
  const stats = readRecord(raw.stats);
  const time = readRecord(raw.time);
  let parsedCharacters: WorldCharacterItem[] | undefined;
  if ('characters' in raw && Array.isArray(raw.characters)) {
    parsedCharacters = raw.characters.map((character: WorldCharacterSummaryDto) => {
      return {
        id: character.id,
        name: character.name || 'Unknown',
        handle: character.handle ?? undefined,
        bio: character.bio ?? undefined,
        avatarUrl: character.avatarUrl ?? null,
        profileCoverUrl: character.profileCoverUrl ?? null,
        createdAt: character.createdAt,
        sourceRef: character.sourceRef ?? null,
      };
    });
  }
  const characterCount = typeof raw.characterCount === 'number'
    ? raw.characterCount
    : readNumber(stats?.characterCount) != null
      ? readNumber(stats?.characterCount) ?? 0
    : parsedCharacters?.length
      ? parsedCharacters.length
      : 0;
  const personaCount = typeof raw.personaCount === 'number'
    ? raw.personaCount
    : readNumber(stats?.personaCount) ?? 0;
  const sceneCount = typeof raw.sceneCount === 'number'
    ? raw.sceneCount
    : readNumber(stats?.sceneCount) ?? 0;
  const systemCount = typeof raw.systemCount === 'number'
    ? raw.systemCount
    : readNumber(stats?.systemCount) ?? 0;
  const timelineEventCount = typeof raw.timelineEventCount === 'number'
    ? raw.timelineEventCount
    : readNumber(stats?.timelineEventCount) ?? 0;

  return {
    id: String(raw.id || ''),
    name: readString(raw.name)
      ?? (() => {
        throw new Error('World list item requires display name');
      })(),
    description: readString(raw.description)
      ?? readString(raw.summary)
      ?? null,
    tagline: readString(raw.tagline),
    motto: typeof raw.motto === 'string' ? raw.motto : null,
    overview: typeof raw.overview === 'string' ? raw.overview : null,
    contentRating: typeof raw.contentRating === 'string' ? raw.contentRating : null,
    genre: typeof raw.genre === 'string' ? raw.genre : Array.isArray(raw.tags) && typeof raw.tags[0] === 'string' ? raw.tags[0] : null,
    themes: Array.isArray(raw.themes)
      ? raw.themes.filter((t): t is string => typeof t === 'string')
      : Array.isArray(raw.tags)
        ? raw.tags.filter((t): t is string => typeof t === 'string')
      : [],
    era: readString(raw.era),
    iconUrl: readString(raw.iconUrl) ?? readNamedString(media, 'iconUrl'),
    bannerUrl: readString(raw.bannerUrl)
      ?? readNamedString(media, 'bannerUrl', 'heroUrl'),
    highlightUrls: readStringArray(raw.highlightUrls).length > 0
      ? readStringArray(raw.highlightUrls)
      : readStringArray(media?.highlightUrls),
    type: resolveWorldType(raw),
    status: readString(raw.status) ?? 'DISCOVERABLE',
    visibility: readString(raw.visibility),
    level: typeof raw.level === 'number' ? raw.level : 1,
    levelUpdatedAt: typeof raw.levelUpdatedAt === 'string' ? raw.levelUpdatedAt : null,
    characterCount,
    personaCount,
    sceneCount,
    systemCount,
    timelineEventCount,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    creatorId: resolveCreatorId(raw),
    freezeReason: typeof raw.freezeReason === 'string' ? raw.freezeReason : null,
    scoreA: typeof raw.scoreA === 'number' ? raw.scoreA : 0,
    scoreC: typeof raw.scoreC === 'number' ? raw.scoreC : 0,
    scoreE: typeof raw.scoreE === 'number' ? raw.scoreE : 0,
    scoreEwma: typeof raw.scoreEwma === 'number' ? raw.scoreEwma : 0,
    scoreQ: typeof raw.scoreQ === 'number' ? raw.scoreQ : 0,
    computed: toWorldComputed(raw.computed ?? { time }, characterCount),
    characters: parsedCharacters,
  };
}
