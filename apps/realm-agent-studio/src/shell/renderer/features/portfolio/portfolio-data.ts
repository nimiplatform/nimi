import type { RealmServiceResult } from '@nimiplatform/sdk/realm';

export type MyRealmAgentDto = RealmServiceResult<'MeService', 'listMyRealmAgents'>[number];

export type FriendCountMetric =
  | { status: 'available'; value: number }
  | { status: 'source-unavailable'; label: 'friendCount source unavailable' };

export type OwnerPortfolioAgent = {
  id: string;
  displayName: string;
  handle: string;
  coverUrl: string | null;
  avatarUrl: string | null;
  ownerScope: 'owner-created';
  source: 'Realm MeService.listMyRealmAgents';
  realmState: string | null;
  worldName: string | null;
  updatedAt: string | null;
  friendCount: FriendCountMetric;
};

export type PortfolioFailureKind =
  | 'realm-unavailable'
  | 'permission-missing'
  | 'owner-authority-missing'
  | 'unknown';

export type PortfolioFailure = {
  kind: PortfolioFailureKind;
  title: 'Realm unavailable' | 'Permission missing' | 'owner authority missing' | 'Portfolio unavailable';
  detail: string;
};

function readOptionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readHttpStatus(error: unknown): number | null {
  const errorRecord = readOptionalRecord(error);
  const details = readOptionalRecord(errorRecord?.details);
  return readNumber(errorRecord?.status) || readNumber(details?.httpStatus);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readWorldName(agentProfile: Record<string, unknown> | null): string | null {
  const world = readOptionalRecord(agentProfile?.world);
  return readString(world?.name) || readString(agentProfile?.worldName) || readString(agentProfile?.worldId);
}

function readUpdatedAt(agent: MyRealmAgentDto): string | null {
  const record = agent as Record<string, unknown>;
  const profile = readOptionalRecord(record.agentProfile);
  const metadata = readOptionalRecord(record.agent);
  return readString(profile?.updatedAt) || readString(metadata?.updatedAt) || readString(record.createdAt);
}

export function normalizeFriendCount(agent: MyRealmAgentDto): FriendCountMetric {
  if (Object.prototype.hasOwnProperty.call(agent, 'friendCount') && typeof agent.friendCount === 'number') {
    return { status: 'available', value: agent.friendCount };
  }
  return { status: 'source-unavailable', label: 'friendCount source unavailable' };
}

export function normalizeOwnerPortfolioAgent(agent: MyRealmAgentDto): OwnerPortfolioAgent {
  const profile = readOptionalRecord(agent.agentProfile);

  return {
    id: agent.id,
    displayName: agent.displayName,
    handle: agent.handle,
    coverUrl: agent.profileCoverUrl || null,
    avatarUrl: agent.avatarUrl || null,
    ownerScope: 'owner-created',
    source: 'Realm MeService.listMyRealmAgents',
    realmState: readString(profile?.state),
    worldName: readWorldName(profile),
    updatedAt: readUpdatedAt(agent),
    friendCount: normalizeFriendCount(agent),
  };
}

export function normalizeOwnerPortfolio(agents: MyRealmAgentDto[]): OwnerPortfolioAgent[] {
  return agents.map(normalizeOwnerPortfolioAgent);
}

export function classifyPortfolioFailure(error: unknown): PortfolioFailure {
  const status = readHttpStatus(error);
  if (status === 401 || status === 403) {
    return {
      kind: 'permission-missing',
      title: 'Permission missing',
      detail: 'The canonical GET /api/me/agents owner portfolio read did not authorize this session.',
    };
  }

  const message = error instanceof Error ? error.message : '';
  if (/owner|MASTER_OWNED|authority/i.test(message)) {
    return {
      kind: 'owner-authority-missing',
      title: 'owner authority missing',
      detail: 'Realm did not prove current-user owner-created authority for this portfolio.',
    };
  }

  if (/fetch|network|timeout|realm/i.test(message)) {
    return {
      kind: 'realm-unavailable',
      title: 'Realm unavailable',
      detail: 'MeService.listMyRealmAgents could not reach Realm.',
    };
  }

  return {
    kind: 'unknown',
    title: 'Portfolio unavailable',
    detail: 'GET /api/me/agents did not return a usable owner portfolio.',
  };
}
