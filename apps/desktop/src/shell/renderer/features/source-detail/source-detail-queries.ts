import { realmSourceDetailData } from './data/realm-source-detail-data';
import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  realmSourceRefKey,
  resolveRealmPersonaSourceState,
} from '@renderer/features/explore/realm-persona-source-materialization';
import type { NimiRealmCoreSourceRef } from '@nimiplatform/sdk/realm';
import type { SourceDetailData } from './source-detail-model.js';
import { toSourceDetailData } from './source-detail-model.js';

export type SourceDetailStats = {
  friendsCount: number;
  postsCount: number;
  likesCount: number;
};

export type SourceDisplayDetail = {
  source: SourceDetailData;
  stats: SourceDetailStats | null;
  worldScore: number;
};

export type SourceDisplayDetailSelection = string | NimiRealmCoreSourceRef;

function normalizeSourceStats(raw: JsonObject): SourceDetailStats | null {
  const statsData = parseOptionalJsonObject(raw.stats) as (JsonObject & {
    friendsCount?: number;
    postsCount?: number;
  }) | undefined;
  return {
    friendsCount: statsData?.friendsCount ?? 0,
    postsCount: statsData?.postsCount ?? 0,
    likesCount: 0,
  };
}

function normalizeWorldScore(raw: JsonObject): number {
  const worldData = parseOptionalJsonObject(raw.world) as (JsonObject & {
    scoreEwma?: number;
  }) | undefined;
  return worldData?.scoreEwma ?? (
    typeof raw.worldScoreEwma === 'number' ? raw.worldScoreEwma : 0
  );
}

function isCoreSourceRefSelection(value: SourceDisplayDetailSelection): value is NimiRealmCoreSourceRef {
  return typeof value === 'object'
    && value !== null
    && (value.kind === 'worldCharacter' || value.kind === 'realmPersona')
    && typeof value.worldId === 'string'
    && typeof value.sourceId === 'string'
    && typeof value.sourceContentHash === 'string';
}

function normalizeSourceRefSelection(value: SourceDisplayDetailSelection): NimiRealmCoreSourceRef | null {
  if (!isCoreSourceRefSelection(value)) {
    return null;
  }
  const worldId = String(value.worldId || '').trim();
  const sourceId = String(value.sourceId || '').trim();
  const sourceContentHash = String(value.sourceContentHash || '').trim();
  if (!worldId || !sourceId || !sourceContentHash) {
    return null;
  }
  return {
    kind: value.kind,
    worldId,
    sourceId,
    sourceContentHash,
  };
}

export function sourceDisplayDetailQueryKey(selection: SourceDisplayDetailSelection) {
  const normalizedSourceRef = normalizeSourceRefSelection(selection);
  return [
    'source-display-detail',
    normalizedSourceRef ? realmSourceRefKey(normalizedSourceRef) : String(selection || '').trim(),
  ] as const;
}

export async function fetchSourceDisplayDetail(selection: SourceDisplayDetailSelection): Promise<SourceDisplayDetail | null> {
  const normalizedSourceRef = normalizeSourceRefSelection(selection);
  const normalizedIdentifier = normalizedSourceRef ? '' : String(selection || '').trim();
  if (!normalizedSourceRef && !normalizedIdentifier) {
    return null;
  }
  const sourceResult = normalizedSourceRef
    ? await realmSourceDetailData.loadRealmSourceDetailsBySourceRef(normalizedSourceRef)
    : await realmSourceDetailData.loadRealmSourceDetailsForDisplay(normalizedIdentifier);
  const sourceState = resolveRealmPersonaSourceState(sourceResult);
  return {
    source: toSourceDetailData(sourceResult, sourceState),
    stats: normalizeSourceStats(sourceResult),
    worldScore: normalizeWorldScore(sourceResult),
  };
}
