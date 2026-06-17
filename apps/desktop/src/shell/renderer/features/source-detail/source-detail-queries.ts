import { realmSourceDetailData } from './data/realm-source-detail-data';
import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  loadRealmPersonaSourceAdmissionProjection,
  resolveRealmPersonaSourceState,
} from '@renderer/features/explore/realm-persona-source-admission';
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

export function sourceDisplayDetailQueryKey(sourceIdentifier: string) {
  return ['source-display-detail', String(sourceIdentifier || '').trim()] as const;
}

export async function fetchSourceDisplayDetail(sourceIdentifier: string): Promise<SourceDisplayDetail | null> {
  const normalizedIdentifier = String(sourceIdentifier || '').trim();
  if (!normalizedIdentifier) {
    return null;
  }
  const [result, socialProjection] = await Promise.all([
    realmSourceDetailData.loadRealmSourceDetailsForDisplay(normalizedIdentifier),
    loadRealmPersonaSourceAdmissionProjection(),
  ]);
  const sourceId = String(result.id || '').trim();
  const sourceState = resolveRealmPersonaSourceState(sourceId, socialProjection);
  return {
    source: toSourceDetailData(result, sourceState),
    stats: normalizeSourceStats(result),
    worldScore: normalizeWorldScore(result),
  };
}
