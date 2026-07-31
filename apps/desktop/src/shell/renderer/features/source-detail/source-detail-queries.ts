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
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
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
};

export type SourceDisplayDetailSelection = CharacterSourceRefV3;

function normalizeSourceStats(raw: JsonObject): SourceDetailStats | null {
  const statsData = parseOptionalJsonObject(raw.stats) as (JsonObject & {
    friendsCount?: number;
    postsCount?: number;
    likesCount?: number;
  }) | undefined;
  if (!statsData
    || typeof statsData.friendsCount !== 'number'
    || typeof statsData.postsCount !== 'number'
    || typeof statsData.likesCount !== 'number') {
    return null;
  }
  return {
    friendsCount: statsData.friendsCount,
    postsCount: statsData.postsCount,
    likesCount: statsData.likesCount,
  };
}

export function sourceDisplayDetailQueryKey(selection: SourceDisplayDetailSelection) {
  const normalizedSourceRef = readCharacterSourceRefV3(selection);
  return [
    'source-display-detail',
    normalizedSourceRef ? characterSourceRefKey(normalizedSourceRef) : 'invalid-character-source-ref-v3',
  ] as const;
}

export async function fetchSourceDisplayDetail(
  selection: SourceDisplayDetailSelection,
  sdk: DesktopRendererSdkPort,
): Promise<SourceDisplayDetail | null> {
  const normalizedSourceRef = readCharacterSourceRefV3(selection);
  if (!normalizedSourceRef) return null;
  const sourceResult = await realmSourceDetailData.loadRealmSourceDetailsBySourceRef(
    sdk.realm(),
    normalizedSourceRef,
  );
  const sourceState = resolveCharacterSourceState(sourceResult);
  return {
    source: toSourceDetailData(sourceResult, sourceState),
    stats: normalizeSourceStats(sourceResult),
  };
}
