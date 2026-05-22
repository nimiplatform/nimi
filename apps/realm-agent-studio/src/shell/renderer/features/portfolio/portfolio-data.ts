import type { RealmServiceResult } from '@nimiplatform/sdk/realm';

export type MyRealmAgentDto = RealmServiceResult<'MeService', 'listMyRealmAgents'>[number];
export type MyRealmAgentDetailDto = RealmServiceResult<'MeService', 'getMyRealmAgent'>;

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

export type OwnerPortfolioFilter = 'all' | 'friend-count-available' | 'friend-count-unavailable';
export type OwnerPortfolioSort = 'realm-order' | 'display-name-asc' | 'updated-desc' | 'friend-count-desc' | 'friend-count-asc';

export type OwnerPortfolioViewControls = {
  query: string;
  filter: OwnerPortfolioFilter;
  sort: OwnerPortfolioSort;
};

export type SettingFieldKey =
  | 'displayName'
  | 'handle'
  | 'bio'
  | 'greeting'
  | 'profileCoverUrl'
  | 'ownership'
  | 'world'
  | 'state';

export type SettingField = {
  key: SettingFieldKey;
  label: string;
  value: string;
  status: 'available' | 'source-unavailable';
  source: 'Realm MeService.getMyRealmAgent';
  readOnly: true;
  unavailableLabel?: 'setting read unavailable';
};

export type OwnerPortfolioAgentDetail = {
  id: string;
  displayName: SettingField;
  handle: SettingField;
  bio: SettingField;
  greeting: SettingField;
  profileCoverUrl: SettingField;
  ownership: SettingField;
  world: SettingField;
  state: SettingField;
  avatarUrl: string | null;
  friendCount: FriendCountMetric;
  source: 'Realm MeService.getMyRealmAgent';
};

export type PortfolioFailureKind =
  | 'realm-unavailable'
  | 'permission-missing'
  | 'owner-authority-missing'
  | 'setting-read-unavailable'
  | 'unknown';

export type PortfolioFailure = {
  kind: PortfolioFailureKind;
  title: 'Realm unavailable' | 'Permission missing' | 'owner authority missing' | 'Setting read unavailable' | 'Portfolio unavailable';
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

function readWorldEvidence(agentProfile: Record<string, unknown> | null): string | null {
  return readString(agentProfile?.activeWorldId)
    || readString(agentProfile?.ownerWorldId)
    || readString(agentProfile?.worldId);
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

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
}

function compareUpdatedDesc(left: OwnerPortfolioAgent, right: OwnerPortfolioAgent): number {
  if (left.updatedAt && right.updatedAt) {
    return right.updatedAt.localeCompare(left.updatedAt) || compareText(left.displayName, right.displayName);
  }
  if (left.updatedAt) {
    return -1;
  }
  if (right.updatedAt) {
    return 1;
  }
  return compareText(left.displayName, right.displayName);
}

function compareFriendCount(left: OwnerPortfolioAgent, right: OwnerPortfolioAgent, direction: 'asc' | 'desc'): number {
  const leftMetric = left.friendCount;
  const rightMetric = right.friendCount;
  const leftAvailable = leftMetric.status === 'available';
  const rightAvailable = rightMetric.status === 'available';
  if (leftAvailable && rightAvailable) {
    const valueComparison = direction === 'desc'
      ? rightMetric.value - leftMetric.value
      : leftMetric.value - rightMetric.value;
    return valueComparison || compareText(left.displayName, right.displayName);
  }
  if (leftAvailable) {
    return -1;
  }
  if (rightAvailable) {
    return 1;
  }
  return compareText(left.displayName, right.displayName);
}

function agentMatchesQuery(agent: OwnerPortfolioAgent, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return true;
  }

  return [
    agent.id,
    agent.displayName,
    agent.handle,
    agent.worldName || '',
    agent.realmState || '',
  ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

function agentMatchesFilter(agent: OwnerPortfolioAgent, filter: OwnerPortfolioFilter): boolean {
  if (filter === 'friend-count-available') {
    return agent.friendCount.status === 'available';
  }
  if (filter === 'friend-count-unavailable') {
    return agent.friendCount.status === 'source-unavailable';
  }
  return true;
}

export function applyOwnerPortfolioView(
  agents: OwnerPortfolioAgent[],
  controls: OwnerPortfolioViewControls,
): OwnerPortfolioAgent[] {
  const normalizedQuery = controls.query.trim().toLocaleLowerCase();
  const visibleAgents = agents.filter((agent) => (
    agentMatchesQuery(agent, normalizedQuery) && agentMatchesFilter(agent, controls.filter)
  ));

  if (controls.sort === 'realm-order') {
    return visibleAgents;
  }

  return [...visibleAgents].sort((left, right) => {
    if (controls.sort === 'updated-desc') {
      return compareUpdatedDesc(left, right);
    }
    if (controls.sort === 'friend-count-desc') {
      return compareFriendCount(left, right, 'desc');
    }
    if (controls.sort === 'friend-count-asc') {
      return compareFriendCount(left, right, 'asc');
    }
    return compareText(left.displayName, right.displayName);
  });
}

function settingField(key: SettingFieldKey, label: string, value: string | null): SettingField {
  return {
    key,
    label,
    value: value || '',
    status: value ? 'available' : 'source-unavailable',
    source: 'Realm MeService.getMyRealmAgent',
    readOnly: true,
    unavailableLabel: value ? undefined : 'setting read unavailable',
  };
}

export function normalizeOwnerPortfolioAgentDetail(agent: MyRealmAgentDetailDto): OwnerPortfolioAgentDetail {
  const profile = readOptionalRecord(agent.agentProfile);
  return {
    id: agent.id,
    displayName: settingField('displayName', 'Display name', readString(agent.displayName)),
    handle: settingField('handle', 'Handle', readString(agent.handle)),
    bio: settingField('bio', 'Bio', readString(agent.bio)),
    greeting: settingField('greeting', 'Greeting', readString(profile?.greeting)),
    profileCoverUrl: settingField('profileCoverUrl', 'Profile cover URL', readString(agent.profileCoverUrl)),
    ownership: settingField('ownership', 'Ownership evidence', readString(profile?.ownershipType)),
    world: settingField('world', 'World evidence', readWorldEvidence(profile)),
    state: settingField('state', 'State evidence', readString(profile?.state)),
    avatarUrl: agent.avatarUrl || null,
    friendCount: normalizeFriendCount(agent),
    source: 'Realm MeService.getMyRealmAgent',
  };
}

export function classifyRealmAgentReadFailure(error: unknown, read: 'portfolio' | 'detail'): PortfolioFailure {
  const status = readHttpStatus(error);
  if (status === 401 || status === 403) {
    return {
      kind: 'permission-missing',
      title: 'Permission missing',
      detail: read === 'detail'
        ? 'This Runtime account session is not authorized to read that Realm Agent.'
        : 'This Runtime account session is not authorized to read your Realm Agent portfolio.',
    };
  }

  const message = error instanceof Error ? error.message : '';
  if (/owner|MASTER_OWNED|authority/i.test(message)) {
    return {
      kind: 'owner-authority-missing',
      title: 'owner authority missing',
      detail: read === 'detail'
        ? 'Realm did not prove current-user owner-created authority for this Realm Agent detail.'
        : 'Realm did not prove current-user owner-created authority for this portfolio.',
    };
  }

  if (/fetch|network|timeout|realm/i.test(message)) {
    return {
      kind: 'realm-unavailable',
      title: 'Realm unavailable',
      detail: read === 'detail' ? 'Realm Agent detail could not reach Realm.' : 'Owner portfolio could not reach Realm.',
    };
  }

  if (/setting|field|read|shape|schema|parse/i.test(message)) {
    return {
      kind: 'setting-read-unavailable',
      title: 'Setting read unavailable',
      detail: read === 'detail'
        ? 'Realm did not return usable read-only setting fields for this agent.'
        : 'Realm did not return usable portfolio fields.',
    };
  }

  return {
    kind: read === 'detail' ? 'setting-read-unavailable' : 'unknown',
    title: read === 'detail' ? 'Setting read unavailable' : 'Portfolio unavailable',
    detail: read === 'detail'
      ? 'Realm did not return a usable user-owned Realm Agent detail.'
      : 'Realm did not return a usable owner portfolio.',
  };
}

export function classifyPortfolioFailure(error: unknown): PortfolioFailure {
  return classifyRealmAgentReadFailure(error, 'portfolio');
}

export function classifyAgentDetailFailure(error: unknown): PortfolioFailure {
  return classifyRealmAgentReadFailure(error, 'detail');
}
