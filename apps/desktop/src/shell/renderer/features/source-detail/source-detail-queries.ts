import { realmSourceDetailData } from './data/realm-source-detail-data';
import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  characterSourceRefKey,
  resolveCharacterSourceState,
} from '../explore/character-source-materialization';
import {
  readCharacterSourceRefV3,
  type CharacterSourceRefV3,
} from '../realm-source/realm-source-identity.js';
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

export type SourceDisplayDetailSelection = CharacterSourceRefV3;

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

export function sourceDisplayDetailQueryKey(selection: SourceDisplayDetailSelection) {
  const normalizedSourceRef = readCharacterSourceRefV3(selection);
  return [
    'source-display-detail',
    normalizedSourceRef ? characterSourceRefKey(normalizedSourceRef) : 'invalid-character-source-ref-v3',
  ] as const;
}

export async function fetchSourceDisplayDetail(selection: SourceDisplayDetailSelection): Promise<SourceDisplayDetail | null> {
  const normalizedSourceRef = readCharacterSourceRefV3(selection);
  if (!normalizedSourceRef) return null;
  const sourceResult = await realmSourceDetailData.loadRealmSourceDetailsBySourceRef(normalizedSourceRef);
  const sourceState = resolveCharacterSourceState(sourceResult);
  return {
    source: toSourceDetailData(sourceResult, sourceState),
    stats: normalizeSourceStats(sourceResult),
    worldScore: normalizeWorldScore(sourceResult),
  };
}
