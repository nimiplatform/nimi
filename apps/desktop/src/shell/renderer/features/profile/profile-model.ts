import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import type { NimiRealmCoreSourceRef } from '@nimiplatform/sdk/realm';
import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { SourceDetailEntity } from '@renderer/features/source-detail/source-detail-model.js';
import {
  assertRealmCoreSourceRefMatchesOuterIdentity,
  normalizeRealmSourceKind,
  readRealmCoreSourceRef,
} from '@renderer/features/realm-source/realm-source-identity.js';

export type ProfileTab = 'Posts' | 'Collections' | 'Likes' | 'Gifts';

export const PROFILE_TABS: ProfileTab[] = ['Posts', 'Collections', 'Likes', 'Gifts'];

export type GiftWallItem = {
  id: string;
  name: string;
  emoji: string;
  iconUrl: string | null;
  energyCost: string;
  count: number;
};

export type ProfileData = {
  accessState: 'full' | 'restricted';
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  isSource: boolean;
  isOnline: boolean;
  isFriend: boolean;
  isPendingFriendRequest: boolean;
  createdAt: string;
  tags: string[];
  languages: string[];
  city: string | null;
  countryCode: string | null;
  gender: string | null;
  stats: { friendsCount: number; postsCount: number; likesCount: number } | null;
  giftStats: Record<string, number>;
  sourceState: string | null;
  sourceArchetype: string | null;
  sourceOrigin: string | null;
  sourceTier: string | null;
  sourceVisibility: string | null;
  sourcePacing: string | null;
  sourceOwnershipType: string | null;
  sourceWorldId: string | null;
  sourceKind: NimiRealmCoreSourceRef['kind'] | null;
  sourceId: string | null;
  sourceContentHash: string | null;
  runtimeSourceRef: string | null;
  sourceRef: NimiRealmCoreSourceRef | null;
  entityId: string | null;
  entityContentHash: string | null;
  entity: SourceDetailEntity | null;
  worldName: string | null;
  worldBannerUrl: string | null;
};

type UserProfileDto = RealmModel<'UserProfileDto'>;
type ProfileStatsLike = NonNullable<UserProfileDto['stats']> & {
  likesCount?: number;
  likeCount?: number;
};
type ProfileSourceRecordLike = {
  importance?: string | null;
  origin?: string | null;
  ownershipType?: string | null;
  personaStyle?: {
    archetype?: string | null;
    pacing?: string | null;
  } | null;
  state?: string | null;
  tier?: string | null;
  visibility?: string | null;
  worldId?: string | null;
  worldName?: string | null;
  worldBannerUrl?: string | null;
};
type ProfileWorldLike = {
  name?: string | null;
  bannerUrl?: string | null;
};
type ProfileSourceGeneratedBase = Partial<Omit<
  UserProfileDto,
  | 'avatarUrl'
  | 'bio'
  | 'city'
  | 'countryCode'
  | 'createdAt'
  | 'displayName'
  | 'gender'
  | 'giftStats'
  | 'handle'
  | 'id'
  | 'isSource'
  | 'languages'
  | 'stats'
  | 'tags'
>>;
export type ProfileSource = ProfileSourceGeneratedBase & {
  createdAt?: string | null;
  displayName?: string;
  handle?: string;
  gender?: string | null;
  id?: string;
  isSource?: boolean;
  sourceRef?: unknown;
  sourceContentHash?: string | null;
  runtimeSourceRef?: string | null;
  sourceKind?: string | null;
  sourceId?: string | null;
  originKind?: string | null;
  isCreator?: boolean;
  isVerified?: boolean;
  followerCount?: number;
  followingCount?: number;
  avatarUrl?: string | null;
  bio?: string | null;
  city?: string | null;
  countryCode?: string | null;
  languages?: readonly string[];
  postCount?: number;
  tags?: readonly string[];
  isFriend?: boolean;
  isPendingFriendRequest?: boolean;
  worldId?: string | null;
  sourceWorldId?: string | null;
  entityId?: string | null;
  entityContentHash?: string | null;
  entity?: unknown;
  sourceConfig?: object | null;
  worldName?: string | null;
  worldBannerUrl?: string | null;
  likesCount?: number;
  likeCount?: number;
  stats?: ProfileStatsLike | null;
  giftStats?: Record<string, unknown> | null;
  source?: ProfileSourceRecordLike | null;
  world?: ProfileWorldLike | null;
};

function hasRealmSourceIdentity(raw: ProfileSource): boolean {
  if (raw.isSource === true) return true;
  if (typeof raw.sourceRef === 'string' && raw.sourceRef.trim()) return true;
  if (raw.sourceRef && typeof raw.sourceRef === 'object' && !Array.isArray(raw.sourceRef)) return true;
  if (typeof raw.runtimeSourceRef === 'string' && raw.runtimeSourceRef.trim()) return true;
  if (typeof raw.sourceKind === 'string' && raw.sourceKind.trim()) return true;
  if (typeof raw.originKind === 'string' && raw.originKind.trim()) return true;
  return Boolean(raw.source);
}

function normalizeSourceKind(value: unknown): NimiRealmCoreSourceRef['kind'] | null {
  return normalizeRealmSourceKind(value);
}

function readObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readOptionalStringRecord(value: unknown, key: string): string | null {
  const record = readObjectRecord(value);
  if (!record) {
    return null;
  }
  const entry = record[key];
  return typeof entry === 'string' && entry.trim() ? entry.trim() : null;
}

function readSourceRef(value: unknown): NimiRealmCoreSourceRef | null {
  return readRealmCoreSourceRef(value);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function readEntityFacts(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.map(parseOptionalJsonObject).filter((item): item is JsonObject => Boolean(item))
    : [];
}

function readProfileEntity(value: unknown): SourceDetailEntity | null {
  const entity = readObjectRecord(value);
  if (!entity) {
    return null;
  }
  const id = readOptionalStringRecord(entity, 'id');
  const kind = readOptionalStringRecord(entity, 'kind');
  const name = readOptionalStringRecord(entity, 'name');
  const contentHash = readOptionalStringRecord(entity, 'contentHash');
  if (!id || !kind || !name || !contentHash) {
    return null;
  }
  return {
    id,
    kind,
    name,
    summary: readOptionalStringRecord(entity, 'summary'),
    contentHash,
    tags: readStringArray(entity.tags),
    facts: readEntityFacts(entity.facts),
  };
}

export function toProfileData(raw: ProfileSource): ProfileData {
  const sourceRecord = raw.source ?? undefined;
  const stats = raw.stats;
  const giftStats = raw.giftStats;
  const world = raw.world;
  const sourceRefFromPayload = readSourceRef(raw.sourceRef);
  const outerSourceId = typeof raw.sourceId === 'string' ? raw.sourceId.trim() : '';
  const outerSourceContentHash = (
    (typeof raw.sourceContentHash === 'string' ? raw.sourceContentHash.trim() : '')
    || readOptionalStringRecord(sourceRecord, 'sourceContentHash')
    || readOptionalStringRecord(sourceRecord, 'contentHash')
  );
  if (sourceRefFromPayload) {
    assertRealmCoreSourceRefMatchesOuterIdentity({
      ...raw,
      sourceKind: raw.sourceKind ?? readOptionalStringRecord(sourceRecord, 'sourceKind'),
      sourceWorldId: (
        readOptionalStringRecord(sourceRecord, 'worldId')
        || (typeof raw.sourceWorldId === 'string' ? raw.sourceWorldId.trim() : '')
      ),
      sourceId: outerSourceId || raw.id,
      sourceContentHash: outerSourceContentHash,
    }, sourceRefFromPayload, 'Profile source');
  }
  const sourceKind = sourceRefFromPayload?.kind
    ?? normalizeSourceKind(raw.sourceKind)
    ?? normalizeSourceKind(readOptionalStringRecord(sourceRecord, 'sourceKind'));
  const sourceWorldId = (
    sourceRefFromPayload?.worldId
    || readOptionalStringRecord(sourceRecord, 'worldId')
    || (typeof raw.sourceWorldId === 'string' ? raw.sourceWorldId.trim() || null : null)
  );
  const personaStyle = sourceRecord?.personaStyle && typeof sourceRecord.personaStyle === 'object' && !Array.isArray(sourceRecord.personaStyle)
    ? sourceRecord.personaStyle
    : null;
  const sourceId = (
    sourceRefFromPayload?.sourceId
    || outerSourceId
    || raw.id
    || null
  );
  const sourceContentHash = (
    sourceRefFromPayload?.sourceContentHash
    || outerSourceContentHash
  );
  const sourceRef = sourceRefFromPayload ?? (sourceKind && sourceWorldId && sourceId && sourceContentHash
    ? {
        kind: sourceKind,
        worldId: sourceWorldId,
        sourceId,
        sourceContentHash,
      }
    : null);

  const parsedGiftStats: Record<string, number> = {};
  if (giftStats) {
    for (const [key, val] of Object.entries(giftStats)) {
      if (typeof val === 'number') parsedGiftStats[key] = val;
    }
  }
  const entity = readProfileEntity(raw.entity);
  const entityContentHash = (
    (typeof raw.entityContentHash === 'string' ? raw.entityContentHash.trim() : '')
    || entity?.contentHash
    || null
  );

  return {
    accessState: 'full',
    id: String(raw.id || ''),
    displayName: String(raw.displayName || raw.handle || 'Unknown'),
    handle: String(raw.handle || ''),
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null,
    bio: typeof raw.bio === 'string' ? raw.bio : null,
    isSource: hasRealmSourceIdentity(raw),
    isOnline: raw.isOnline === true,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    languages: Array.isArray(raw.languages) ? raw.languages.map(String) : [],
    city: typeof raw.city === 'string' ? raw.city : null,
    countryCode: typeof raw.countryCode === 'string' ? raw.countryCode : null,
    gender: typeof raw.gender === 'string' ? raw.gender : null,
    stats: stats
      ? {
          friendsCount: typeof stats.friendsCount === 'number' ? stats.friendsCount : 0,
          postsCount: typeof stats.postsCount === 'number' ? stats.postsCount : 0,
          likesCount: typeof stats.likesCount === 'number'
            ? stats.likesCount
            : typeof stats.likeCount === 'number'
              ? stats.likeCount
              : typeof raw.likesCount === 'number'
                ? raw.likesCount
                : typeof raw.likeCount === 'number'
                  ? raw.likeCount
                  : 0,
        }
      : null,
    giftStats: parsedGiftStats,
    sourceState: sourceRecord && typeof sourceRecord.state === 'string' ? sourceRecord.state : null,
    sourceArchetype: personaStyle && typeof personaStyle.archetype === 'string' ? personaStyle.archetype : null,
    sourceOrigin: sourceRecord && typeof sourceRecord.origin === 'string' ? sourceRecord.origin : null,
    sourceTier: sourceRecord && typeof sourceRecord.tier === 'string' ? sourceRecord.tier : null,
    sourceVisibility: (
      (sourceRecord && typeof sourceRecord.visibility === 'string' ? sourceRecord.visibility : null)
    ),
    sourcePacing: personaStyle && typeof personaStyle.pacing === 'string' ? personaStyle.pacing : null,
    sourceOwnershipType: (
      (sourceRecord && typeof sourceRecord.ownershipType === 'string' ? sourceRecord.ownershipType : null)
    ),
    sourceWorldId,
    sourceKind,
    sourceId,
    sourceContentHash,
    runtimeSourceRef: (
      (typeof raw.runtimeSourceRef === 'string' ? raw.runtimeSourceRef.trim() : '')
      || null
    ),
    sourceRef,
    entityId: (
      (typeof raw.entityId === 'string' ? raw.entityId.trim() : '')
      || entity?.id
      || null
    ),
    entityContentHash,
    entity,
    worldName: (
      (typeof raw.worldName === 'string' ? raw.worldName : null)
      || (typeof world?.name === 'string' ? world.name : null)
    ),
    worldBannerUrl: (
      (typeof raw.worldBannerUrl === 'string' ? raw.worldBannerUrl : null)
      || (typeof world?.bannerUrl === 'string' ? world.bannerUrl : null)
    ),
    isFriend: raw.isFriend === true,
    isPendingFriendRequest: raw.isPendingFriendRequest === true,
  };
}

import { formatLocaleDate } from '@renderer/i18n';

export function getProfileInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function formatProfileDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  return formatLocaleDate(date, { year: 'numeric', month: 'long', day: 'numeric' });
}
