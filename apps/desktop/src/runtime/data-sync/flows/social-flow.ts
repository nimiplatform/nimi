import { CreatorService, UserService } from '@nimiplatform/sdk-realm';

type DataSyncApiCaller = <T>(task: () => Promise<T>, fallbackMessage?: string) => Promise<T>;

function toStringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
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
  const identifier = String(identifierInput || '').trim();
  if (!identifier) {
    throw new Error('Please enter @handle or user ID');
  }

  const isHandleIdentifier = identifier.startsWith('@') || identifier.startsWith('~');
  const maybeHandle = isHandleIdentifier ? identifier.slice(1) : identifier;
  const looksLikeUlid = /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(identifier);

  let user: SearchUserResult | null = null;

  const resolveByHandle = async (handleCandidate: string): Promise<SearchUserResult | null> => {
    const normalized = String(handleCandidate || '').trim();
    if (!normalized) {
      return null;
    }
    const byHandle = await callApi(
      () => UserService.getUserByHandle(normalized),
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
    const handleCandidates = [
      identifier,
      maybeHandle,
    ].filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
    for (const handleCandidate of handleCandidates) {
      try {
        user = await resolveByHandle(handleCandidate);
      } catch {
        user = null;
      }
      if (user) {
        break;
      }
    }
  }

  if (!user && !isHandleIdentifier) {
    const byId = await callApi(
      () => UserService.getUser(identifier),
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

export async function loadCreatorAgents(
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
      () => CreatorService.creatorControllerListAgents(),
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
