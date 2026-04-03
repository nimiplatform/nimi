import type { Realm } from '@nimiplatform/sdk/realm';

type DataSyncApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stripHandlePrefix(value: string): string {
  return value.startsWith('@') || value.startsWith('~') ? value.slice(1) : value;
}

type SearchUserResult = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
  isAgent?: boolean;
  isFriend?: boolean;
};

export function isFriendInContacts(
  contacts: { friends?: Array<Record<string, unknown>> } | undefined,
  userId: string,
): boolean {
  if (!contacts?.friends?.length) return false;
  return contacts.friends.some((friend: Record<string, unknown>) => friend.id === userId);
}

export async function searchUserByIdentifier(
  callApi: DataSyncApiCaller,
  identifierInput: string,
  isFriend: (userId: string) => boolean,
): Promise<SearchUserResult> {
  const identifier = stripHandlePrefix(String(identifierInput || '').trim());
  if (!identifier) {
    throw new Error('Please enter a handle or user ID');
  }

  const looksLikeUlid = /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(identifier);

  let user: SearchUserResult | null = null;

  const resolveByHandle = async (handleCandidate: string): Promise<SearchUserResult | null> => {
    const normalized = String(handleCandidate || '').trim();
    if (!normalized) {
      return null;
    }
    const byHandle = await callApi(
      (realm) => realm.services.UserService.getUserByHandle(normalized),
      '根据 handle 查询用户失败',
    );
    if (!byHandle?.id) {
      return null;
    }
    const avatarUrl = (byHandle as Record<string, unknown>).avatarUrl;
    return {
      id: String(byHandle.id),
      handle: String(byHandle.handle || ''),
      displayName: String(byHandle.displayName || byHandle.handle || 'Unknown user'),
      avatarUrl: toStringOrUndefined(avatarUrl),
      isAgent: (byHandle as Record<string, unknown>).isAgent as boolean | undefined,
      isFriend: isFriend(String(byHandle.id)),
    };
  };

  if (!looksLikeUlid) {
    try {
      user = await resolveByHandle(identifier);
    } catch {
      user = null;
    }
    // If not found as human (@handle), retry with agent prefix (~handle)
    if (!user) {
      try {
        user = await resolveByHandle(`~${identifier}`);
      } catch {
        user = null;
      }
    }
  }

  if (!user) {
    const byId = await callApi(
      (realm) => realm.services.UserService.getUser(identifier),
      '根据用户ID查询失败',
    );
    if (byId?.id) {
      const avatarUrl = (byId as Record<string, unknown>).avatarUrl;
      user = {
        id: String(byId.id),
        handle: String(byId.handle || ''),
        displayName: String(byId.displayName || byId.handle || 'Unknown user'),
        avatarUrl: toStringOrUndefined(avatarUrl),
        isAgent: (byId as Record<string, unknown>).isAgent as boolean | undefined,
        isFriend: isFriend(String(byId.id)),
      };
    }
  }

  if (!user) {
    throw new Error('User not found');
  }

  return user;
}

export type CreateMasterAgentInput = {
  worldId: string;
  handle: string;
  concept: string;
  displayName?: string;
  description?: string;
  scenario?: string;
  greeting?: string;
  referenceImageUrl?: string;
  wakeStrategy?: 'PASSIVE' | 'PROACTIVE';
  dnaPrimary?: 'CARING' | 'PLAYFUL' | 'INTELLECTUAL' | 'CONFIDENT' | 'MYSTERIOUS' | 'ROMANTIC';
  dnaSecondary?: Array<'HUMOROUS' | 'SARCASTIC' | 'GENTLE' | 'DIRECT' | 'OPTIMISTIC' | 'REALISTIC' | 'DRAMATIC' | 'PASSIONATE' | 'REBELLIOUS' | 'INNOCENT' | 'WISE' | 'ECCENTRIC'>;
};

export async function createMasterAgent(
  callApi: DataSyncApiCaller,
  input: CreateMasterAgentInput,
): Promise<Record<string, unknown>> {
  const result = await callApi(
    (realm) => realm.services.CreatorService.creatorControllerCreateAgent({
      handle: input.handle.trim(),
      concept: input.concept.trim(),
      displayName: input.displayName?.trim() || undefined,
      description: input.description?.trim() || undefined,
      referenceImageUrl: input.referenceImageUrl?.trim() || undefined,
      dnaPrimary: input.dnaPrimary,
      dnaSecondary: input.dnaSecondary?.length ? input.dnaSecondary : undefined,
      ownershipType: 'MASTER_OWNED',
      worldId: input.worldId,
    }),
    '创建 Agent 失败',
  );
  return (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
}

let inflightCreatorAgents: Promise<Record<string, unknown>[]> | null = null;

export async function loadCreatorAgents(
  callApi: DataSyncApiCaller,
): Promise<Record<string, unknown>[]> {
  if (inflightCreatorAgents) return inflightCreatorAgents;
  const task = loadCreatorAgentsInternal(callApi).finally(() => { inflightCreatorAgents = null; });
  inflightCreatorAgents = task;
  return task;
}

async function loadCreatorAgentsInternal(
  callApi: DataSyncApiCaller,
): Promise<Record<string, unknown>[]> {
  const deniedFlagKey = 'nimi.data-sync.creator-agents.denied';
  try {
    if (sessionStorage.getItem(deniedFlagKey) === '1') {
      return [];
    }
  } catch {
    // ignore
  }

  try {
    const agents = await callApi(
      (realm) => realm.services.CreatorService.creatorControllerListAgents(),
      '加载我的 Agent 列表失败',
    );
    return Array.isArray(agents)
      ? agents.map((agent) => (agent && typeof agent === 'object' ? { ...(agent as Record<string, unknown>) } : {}))
      : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (message.includes('Developer access required') || message.includes('Forbidden')) {
      try {
        sessionStorage.setItem(deniedFlagKey, '1');
      } catch {
        // ignore
      }
    }
    return [];
  }
}
