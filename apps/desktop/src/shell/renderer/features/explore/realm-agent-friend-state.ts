// RealmAgent friend-state → primary-action model.
//
// Authority: `.nimi/spec/desktop/kernel/explore-surface-contract.md` D-EXPL-005,
// D-EXPL-006, D-EXPL-007 and `tables/realm-agent-friend-actions.yaml`.
//
// `friendState` is a deterministic projection of Realm social truth
// (the Friendship / AgentFriend graph exposed through `dataSync.loadSocialSnapshot`)
// plus the account Agent-friend quota. It is NOT a renderer-local guess: every
// RealmAgent card consumes this single resolver so the four typed states
// (`not_friend` / `pending` / `friend` / `limit_reached`) stay consistent.

import { dataSync } from '@runtime/data-sync';
import { i18n } from '@renderer/i18n';
import { parseOptionalJsonObject } from '@renderer/bridge/runtime-bridge/shared';
import type { AgentFriendLimit } from '../relationship/agent-friend-limit';
import { resolveAgentFriendLimit } from '../relationship/agent-friend-limit';

export type RealmAgentFriendState = 'not_friend' | 'pending' | 'friend' | 'limit_reached';

export type RealmAgentPrimaryAction = 'add_friend' | 'pending' | 'open_agent_chat' | 'manage_agent_friends';

// Deterministic state-machine fact source mirror — see
// `tables/realm-agent-friend-actions.yaml`. The primary action for each state
// is fixed; renderers must not derive a different action.
const PRIMARY_ACTION_BY_STATE: Record<RealmAgentFriendState, RealmAgentPrimaryAction> = {
  not_friend: 'add_friend',
  pending: 'pending',
  friend: 'open_agent_chat',
  limit_reached: 'manage_agent_friends',
};

export function primaryActionForFriendState(state: RealmAgentFriendState): RealmAgentPrimaryAction {
  return PRIMARY_ACTION_BY_STATE[state];
}

export type RealmAgentPrimaryActionLabel = {
  state: RealmAgentFriendState;
  action: RealmAgentPrimaryAction;
  label: string;
  // `pending` is non-actionable (no duplicate friend request); `limit_reached`
  // routes to Manage Agent friends. `add_friend` / `open_agent_chat` are the
  // actionable primary paths.
  disabled: boolean;
};

export function describeRealmAgentPrimaryAction(state: RealmAgentFriendState): RealmAgentPrimaryActionLabel {
  const action = primaryActionForFriendState(state);
  switch (action) {
    case 'add_friend':
      return {
        state,
        action,
        label: i18n.t('Explore.friendshipAdd', { defaultValue: 'Add friend' }),
        disabled: false,
      };
    case 'pending':
      return {
        state,
        action,
        label: i18n.t('Explore.friendshipPending', { defaultValue: 'Pending' }),
        disabled: true,
      };
    case 'open_agent_chat':
      return {
        state,
        action,
        label: i18n.t('Explore.friendshipOpenAgentChat', { defaultValue: 'Open Agent Chat' }),
        disabled: false,
      };
    case 'manage_agent_friends':
      return {
        state,
        action,
        label: i18n.t('Explore.friendshipManageAgentFriends', { defaultValue: 'Manage Agent friends' }),
        disabled: false,
      };
    default:
      return {
        state,
        action,
        label: i18n.t('Explore.friendshipAdd', { defaultValue: 'Add friend' }),
        disabled: false,
      };
  }
}

// Realm social-truth projection used to resolve every RealmAgent card's
// `friendState`. Resolved once per Explore / agent-detail render via react-query
// and shared by id lookup.
export type RealmAgentSocialProjection = {
  friendIds: Set<string>;
  pendingSentIds: Set<string>;
  limit: AgentFriendLimit;
};

function recordId(value: unknown): string {
  const record = parseOptionalJsonObject(value);
  const id = record?.id ?? record?.userId;
  return typeof id === 'string' ? id.trim() : '';
}

// Load Realm social truth + Agent friend quota and project the id sets used to
// resolve `friendState` for any RealmAgent. This is the single Realm-truth read;
// `resolveRealmAgentFriendState` below is a pure projection on top of it.
export async function loadRealmAgentSocialProjection(): Promise<RealmAgentSocialProjection> {
  const [snapshot, limit] = await Promise.all([
    dataSync.loadSocialSnapshot(),
    resolveAgentFriendLimit(),
  ]);
  const friendIds = new Set<string>();
  for (const friend of snapshot.friends) {
    const id = recordId(friend);
    if (id) {
      friendIds.add(id);
    }
  }
  const pendingSentIds = new Set<string>();
  for (const pending of snapshot.pendingSent) {
    const id = recordId(pending);
    if (id) {
      pendingSentIds.add(id);
    }
  }
  return { friendIds, pendingSentIds, limit };
}

// Pure deterministic projection: AgentFriend membership wins; an outstanding
// sent request is `pending`; otherwise the account is either able to add
// (`not_friend`) or quota-blocked (`limit_reached`). No generic `unavailable`
// collapse — the typed distinction is preserved per D-EXPL-006.
export function resolveRealmAgentFriendState(
  agentId: string,
  projection: RealmAgentSocialProjection | null | undefined,
): RealmAgentFriendState {
  const id = String(agentId || '').trim();
  if (!id || !projection) {
    return 'not_friend';
  }
  if (projection.friendIds.has(id)) {
    return 'friend';
  }
  if (projection.pendingSentIds.has(id)) {
    return 'pending';
  }
  if (!projection.limit.canAdd) {
    return 'limit_reached';
  }
  return 'not_friend';
}

export const realmAgentSocialProjectionQueryKey = ['realm-agent-social-projection'] as const;
