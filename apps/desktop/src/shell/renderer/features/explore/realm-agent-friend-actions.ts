import { realmSocialData } from '@renderer/features/social/data/realm-social-data';
// RealmAgent Add Friend dual-effect + friend → Open Agent Chat launch.
//
// Authority: `.nimi/spec/desktop/kernel/explore-surface-contract.md` D-EXPL-006,
// D-EXPL-007 and runtime `runtime-agent-service-contract.md` K-AGCORE-139.
//
// D-EXPL-007 dual-effect: `Add friend` on a RealmAgent must (1) create the
// AgentFriend relation (ordinary Realm Friendship row) AND (2) ensure the one
// idempotent account-scoped LocalAgent projection (K-AGCORE-139). The LocalAgent
// projection is ensured on Add Friend here — not deferred to a lazy first
// chat-open — so a befriended RealmAgent's `friend` → Open Agent Chat path is
// always backed by an observable LocalAgent.
//
// Add Friend never mutates RealmAgent canonical truth: it creates the
// AgentFriend Friendship row and forks an owner-scoped LocalAgent projection.

import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import { ensureRuntimeAgentExists } from '@renderer/features/chat/chat-agent-shell-host-actions-helpers';
import { launchAgentConversationFromDisplay } from '@renderer/features/chat/agent-conversation-launcher.js';
import type { AppStoreState } from '@renderer/app-shell/providers/store-types';
import type { ConversationMode } from '@nimiplatform/kit/features/chat/headless';
import type { AgentConversationSelection } from '@renderer/features/chat/chat-shell-types.js';

// Minimal RealmAgent identity needed to build the deterministic localAgentRef
// and the LocalAgent target snapshot. Sourced from the RealmAgent card / detail
// data; never carries renderer-invented execution authority.
export type RealmAgentFriendTarget = {
  realmAgentId: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  worldId: string | null;
  worldName: string | null;
  bio: string | null;
  // Optional ordinary RealmAgent profile content. Explore card data carries
  // identity only; when these are absent the live Realm/SDK agent projection
  // supplies them at chat time.
  greeting?: string | null;
  builtinDocsContext?: string | null;
};

function requireOwnerUserId(): string {
  const ownerUserId = String(
    (useAppStore.getState().auth.user as Record<string, unknown> | null)?.id || '',
  ).trim();
  if (!ownerUserId) {
    throw new Error('RealmAgent friend action requires an authenticated account');
  }
  return ownerUserId;
}

// Build the LocalAgent target snapshot with the deterministic
// `localAgentRef = local-agent:${ownerUserId}:${realmAgentId}` identity
// (Realm chat-contract R-CHAT-016 ~ R-CHAT-020).
function toLocalAgentTarget(
  target: RealmAgentFriendTarget,
  ownerUserId: string,
): AgentLocalTargetSnapshot {
  const realmAgentId = String(target.realmAgentId || '').trim();
  if (!realmAgentId) {
    throw new Error('RealmAgent friend action requires a realmAgentId');
  }
  return {
    ownerUserId,
    realmAgentId,
    localAgentRef: `local-agent:${ownerUserId}:${realmAgentId}`,
    displayName: target.displayName || realmAgentId,
    handle: target.handle || '',
    avatarUrl: target.avatarUrl ?? null,
    worldId: target.worldId ?? null,
    worldName: target.worldName ?? null,
    bio: target.bio ?? null,
    ownershipType: null,
    greeting: target.greeting ?? null,
    builtinDocsContext: target.builtinDocsContext ?? null,
  };
}

// D-EXPL-007 Add Friend dual-effect. Creates the AgentFriend relation, then
// ensures the idempotent account-scoped LocalAgent projection (K-AGCORE-139).
// `ensureRuntimeAgentExists` is itself idempotent (swallows ALREADY_EXISTS), so
// a repeated Add Friend / retry does not produce a second LocalAgent.
export async function addRealmAgentFriend(
  target: RealmAgentFriendTarget,
  message?: string,
): Promise<void> {
  const ownerUserId = requireOwnerUserId();
  const localAgentTarget = toLocalAgentTarget(target, ownerUserId);
  // Effect 1 — create the AgentFriend Realm social relation.
  await realmSocialData.requestOrAcceptFriend(localAgentTarget.realmAgentId, message);
  // Effect 2 — ensure the one idempotent account-scoped LocalAgent projection.
  // If the projection cannot be ensured the error propagates: the caller must
  // surface it as a typed failure rather than projecting a usable `friend`
  // state (D-EXPL-007 fail-closed).
  await ensureRuntimeAgentExists(localAgentTarget);
}

// `friend` → Open Agent Chat. Opens the one-to-one LocalAgent Chat for the
// deterministic localAgentRef. This is the ONLY chat entry point for a
// RealmAgent — there is no direct RealmAgent chat (D-EXPL-006).
export async function openRealmAgentLocalChat(
  target: RealmAgentFriendTarget,
  store: {
    setActiveTab: AppStoreState['setActiveTab'];
    setChatMode: AppStoreState['setChatMode'];
    setSelectedTargetForSource: (source: ConversationMode, targetId: string | null) => void;
    setAgentConversationSelection: (selection: AgentConversationSelection) => void;
  },
): Promise<void> {
  const ownerUserId = requireOwnerUserId();
  const localAgentTarget = toLocalAgentTarget(target, ownerUserId);
  // Ensure the LocalAgent projection exists before routing into chat. Normally
  // already ensured at Add Friend time; this repairs a missing projection
  // idempotently rather than failing the friend → chat path.
  await ensureRuntimeAgentExists(localAgentTarget);
  await launchAgentConversationFromDisplay({
    target: localAgentTarget,
    setActiveTab: store.setActiveTab,
    setChatMode: store.setChatMode,
    setSelectedTargetForSource: store.setSelectedTargetForSource,
    setAgentConversationSelection: store.setAgentConversationSelection,
  });
}
