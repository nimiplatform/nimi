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
  createdAt?: string;
  sourceRef?: NimiRealmCoreSourceRef | null;
};

export type WorldCharacterItem = {
  id: string;
  name: string;
  handle?: string;
  bio?: string;
  avatarUrl?: string | null;
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
  type: string;
  status: string;
  level: number;
  levelUpdatedAt: string | null;
  characterCount: number;
  createdAt: string;
  updatedAt: string | null;
  creatorId: string | null;
  freezeReason: string | null;
  lorebookEntryLimit: number;
  nativeCharacterLimit: number;
  nativeCreationState: string;
  scoreA: number;
  scoreC: number;
  scoreE: number;
  scoreEwma: number;
  scoreQ: number;
  transitInLimit: number;
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

function normalizeCoreEnum(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/[-\s]+/g, '_').toUpperCase()
    : null;
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

function countWorldCharacterEntities(core: LooseObject | null): number {
  const entities = Array.isArray(core?.entities) ? core.entities : [];
  return entities.filter((entry) => {
    const record = readRecord(entry);
    const kind = readNamedString(record, 'kind', 'entityKind', 'type');
    return kind === 'worldCharacter' || normalizeCoreEnum(kind) === 'WORLD_CHARACTER';
  }).length;
}

function toWorldComputed(raw: unknown, coreInput?: unknown, fallbackCharacterCount = 0): WorldComputed {
  const record = readRecord(raw);
  const core = readRecord(coreInput);
  const time = readRecord(record?.time);
  const timeModel = readRecord(core?.timeModel);
  const languages = readRecord(record?.languages);
  const coreLanguages = readRecord(core?.languages);
  const entry = readRecord(record?.entry);
  const score = readRecord(record?.score);
  const coreScore = readRecord(core?.score);

  return {
    time: {
      currentWorldTime: readNamedString(time, 'currentWorldTime') ?? readNamedString(timeModel, 'currentWorldTime', 'currentTime'),
      currentLabel: readNamedString(time, 'currentLabel') ?? readNamedString(timeModel, 'currentLabel', 'currentTimeLabel'),
      eraLabel: readNamedString(time, 'eraLabel') ?? readNamedString(timeModel, 'eraLabel', 'era'),
      flowRatio: Math.max(0.0001, readNamedNumber(time, 'flowRatio') ?? readNamedNumber(timeModel, 'flowRatio') ?? 1),
      isPaused: readNamedBoolean(time, 'isPaused') ?? readNamedBoolean(timeModel, 'isPaused') ?? false,
    },
    languages: {
      primary: readNamedString(languages, 'primary') ?? readNamedString(coreLanguages, 'primary'),
      common: readStringArray(languages?.common).length
        ? readStringArray(languages?.common)
        : readStringArray(coreLanguages?.common),
    },
    entry: {
      recommendedCharacters: Array.isArray(entry?.recommendedCharacters)
        ? entry.recommendedCharacters.map(toComputedCharacter).filter((value): value is WorldComputedEntryCharacter => Boolean(value))
        : [],
    },
    score: {
      scoreEwma: readNamedNumber(score, 'scoreEwma') ?? readNamedNumber(coreScore, 'scoreEwma') ?? 0,
    },
    featuredCharacterCount: readNumber(record?.featuredCharacterCount) ?? fallbackCharacterCount,
  };
}

function resolveWorldType(raw: WorldDetailDto): string {
  const core = readRecord(raw.core);
  const identity = readRecord(core?.identity);
  const origin = readRecord(raw.origin);
  const candidates = [
    raw.id,
    raw.visibility,
    origin?.kind,
    raw.type,
    readNamedString(identity, 'worldType', 'type'),
  ].map(normalizeCoreEnum);
  if (candidates.some((candidate) => candidate === 'OASIS' || candidate === 'SYSTEM' || candidate === 'SYSTEM_DEFAULT')) {
    return 'OASIS';
  }
  return (
    readString(raw.type) ??
    'CREATOR'
  );
}

function resolveWorldStatus(raw: WorldDetailDto): string {
  const core = readRecord(raw.core);
  const lifecycle = readRecord(core?.lifecycle);
  const explicit = normalizeCoreEnum(readNamedString(lifecycle, 'status') ?? readString(raw.status));
  if (
    explicit === 'ACTIVE'
    || explicit === 'SUSPENDED'
    || explicit === 'ARCHIVED'
    || explicit === 'DRAFT'
    || explicit === 'PENDING_REVIEW'
  ) {
    return explicit;
  }
  return 'ACTIVE';
}

function resolveCreatorId(raw: WorldDetailDto): string | null {
  return (
    readString(raw.creatorId) ??
    null
  );
}

function requireWorldDisplayRecord(raw: WorldDetailDto): LooseObject {
  const core = readRecord(raw.core);
  if (!core) {
    throw new Error('World list item requires validated WorldCoreV1 display projection');
  }
  for (const field of ['id', 'name', 'createdAt']) {
    if (!readString(raw[field])) {
      throw new Error(`World list item requires ${field}`);
    }
  }
  if (!readString(raw.contentHash) || readNumber(raw.contentRevision) == null || !readString(raw.schemaVersion)) {
    throw new Error('World list item requires WorldCoreV1 hash, revision, and schemaVersion');
  }
  if (!readRecord(raw.origin) || !readString(readRecord(raw.origin)?.kind)) {
    throw new Error('World list item requires WorldCoreV1 origin');
  }
  if (!readString(raw.visibility)) {
    throw new Error('World list item requires WorldCoreV1 visibility');
  }
  return core;
}

export function isMainWorld(item: Pick<WorldListItem, 'type' | 'creatorId'>): boolean {
  return isMainWorldType(item.type) || !item.creatorId;
}

export function toWorldListItem(raw: WorldDetailDto | WorldDetailWithCharactersDto): WorldListItem {
  const core = requireWorldDisplayRecord(raw);
  const identity = readRecord(core.identity);
  const presentation = readRecord(core.presentation);
  const timeModel = readRecord(core.timeModel);
  let parsedCharacters: WorldCharacterItem[] | undefined;
  if ('characters' in raw && Array.isArray(raw.characters)) {
    parsedCharacters = raw.characters.map((character: WorldCharacterSummaryDto) => {
      return {
        id: character.id,
        name: character.name || 'Unknown',
        handle: character.handle ?? undefined,
        bio: character.bio ?? undefined,
        avatarUrl: character.avatarUrl ?? null,
        createdAt: character.createdAt,
        sourceRef: character.sourceRef ?? null,
      };
    });
  }
  const entityCharacterCount = countWorldCharacterEntities(core);
  const characterCount = typeof raw.characterCount === 'number'
    ? raw.characterCount
    : parsedCharacters?.length
      ? parsedCharacters.length
      : entityCharacterCount;

  return {
    id: String(raw.id || ''),
    name: readString(raw.name)
      ?? readNamedString(identity, 'name', 'title', 'displayName')
      ?? readNamedString(presentation, 'title', 'displayName', 'name')
      ?? (() => {
        throw new Error('World list item requires display name');
      })(),
    description: readString(raw.description)
      ?? readNamedString(identity, 'summary', 'description')
      ?? readNamedString(presentation, 'summary', 'description', 'tagline'),
    tagline: readString(raw.tagline) ?? readNamedString(presentation, 'tagline', 'profileLine'),
    motto: typeof raw.motto === 'string' ? raw.motto : null,
    overview: typeof raw.overview === 'string' ? raw.overview : null,
    contentRating: typeof raw.contentRating === 'string' ? raw.contentRating : null,
    genre: typeof raw.genre === 'string' ? raw.genre : null,
    themes: Array.isArray(raw.themes)
      ? raw.themes.filter((t): t is string => typeof t === 'string')
      : [],
    era: readString(raw.era) ?? readNamedString(timeModel, 'era', 'eraLabel'),
    iconUrl: readString(raw.iconUrl) ?? readNamedString(presentation, 'iconUrl', 'icon_url'),
    bannerUrl: readString(raw.bannerUrl) ?? readNamedString(presentation, 'bannerUrl', 'banner_url'),
    type: resolveWorldType(raw),
    status: resolveWorldStatus(raw),
    level: typeof raw.level === 'number' ? raw.level : 1,
    levelUpdatedAt: typeof raw.levelUpdatedAt === 'string' ? raw.levelUpdatedAt : null,
    characterCount,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    creatorId: resolveCreatorId(raw),
    freezeReason: typeof raw.freezeReason === 'string' ? raw.freezeReason : null,
    lorebookEntryLimit: typeof raw.lorebookEntryLimit === 'number' ? raw.lorebookEntryLimit : 0,
    nativeCharacterLimit: typeof raw.nativeCharacterLimit === 'number' ? raw.nativeCharacterLimit : 0,
    nativeCreationState:
      typeof raw.nativeCreationState === 'string' ? raw.nativeCreationState : 'OPEN',
    scoreA: typeof raw.scoreA === 'number' ? raw.scoreA : 0,
    scoreC: typeof raw.scoreC === 'number' ? raw.scoreC : 0,
    scoreE: typeof raw.scoreE === 'number' ? raw.scoreE : 0,
    scoreEwma: typeof raw.scoreEwma === 'number' ? raw.scoreEwma : 0,
    scoreQ: typeof raw.scoreQ === 'number' ? raw.scoreQ : 0,
    transitInLimit: typeof raw.transitInLimit === 'number' ? raw.transitInLimit : 0,
    computed: toWorldComputed(raw.computed, core, characterCount),
    characters: parsedCharacters,
  };
}
