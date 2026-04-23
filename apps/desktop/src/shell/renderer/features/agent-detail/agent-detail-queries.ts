import { dataSync } from '@runtime/data-sync';
import { parseOptionalJsonObject, type JsonObject } from '@renderer/bridge/runtime-bridge/shared';
import type { AgentDetailData } from './agent-detail-model.js';
import { toAgentDetailData } from './agent-detail-model.js';

export type AgentDetailStats = {
  friendsCount: number;
  postsCount: number;
  likesCount: number;
};

export type AgentDisplayDetail = {
  agent: AgentDetailData;
  stats: AgentDetailStats | null;
  worldScore: number;
};

function normalizeAgentStats(raw: JsonObject): AgentDetailStats | null {
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

export function agentDisplayDetailQueryKey(agentIdentifier: string) {
  return ['agent-display-detail', String(agentIdentifier || '').trim()] as const;
}

export async function fetchAgentDisplayDetail(agentIdentifier: string): Promise<AgentDisplayDetail | null> {
  const normalizedIdentifier = String(agentIdentifier || '').trim();
  if (!normalizedIdentifier) {
    return null;
  }
  const result = await dataSync.loadAgentDetails(normalizedIdentifier);
  const agentId = String(result.id || '').trim();
  const patched = result.isFriend !== true && agentId && dataSync.isFriend(agentId)
    ? { ...result, isFriend: true }
    : result;
  return {
    agent: toAgentDetailData(patched),
    stats: normalizeAgentStats(patched),
    worldScore: normalizeWorldScore(patched),
  };
}
