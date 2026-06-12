import { realmSocialData } from '@renderer/features/social/data/realm-social-data';
// RealmAgent Add Friend dual-effect + friend → Open Agent Chat launch.
//
// Authority: `.nimi/spec/desktop/kernel/explore-surface-contract.md` D-EXPL-006,
// D-EXPL-007 and runtime `runtime-agent-service-contract.md` K-AGCORE-139.
//
// D-EXPL-007 dual-effect: `Add friend` on a RealmAgent must (1) create the
// AgentFriend relation (ordinary Realm Friendship row) AND (2) enqueue the
// durable LocalAgentProvisionIntent in that Realm transaction. Desktop then
// converges the account-scoped LocalAgent projection through the R-SOC-009
// courier; Add Friend must not synchronously call the local runtime.
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
import { buildRuntimeLocalAgentRef } from '@nimiplatform/sdk/runtime';

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

// Build the LocalAgent target snapshot with the deterministic Runtime local
// agent identity (Realm chat-contract R-CHAT-016 ~ R-CHAT-020).
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
    localAgentRef: buildRuntimeLocalAgentRef({ ownerUserId, realmAgentId }),
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

// D-EXPL-007 Add Friend dual-effect. The backend AgentFriend transaction is
// the only authority that creates the durable LocalAgentProvisionIntent; the
// desktop social adapter kicks the R-SOC-009 courier after the transaction
// returns. This function deliberately performs no synchronous runtime write.
export async function addRealmAgentFriend(
  target: RealmAgentFriendTarget,
  message?: string,
): Promise<void> {
  const ownerUserId = requireOwnerUserId();
  const localAgentTarget = toLocalAgentTarget(target, ownerUserId);
  // Effect 1 — create the AgentFriend Realm social relation. Effect 2 — the
  // same backend transaction authors the durable LocalAgentProvisionIntent,
  // which the desktop courier consumes for eventual LocalAgent convergence.
  await realmSocialData.requestOrAcceptFriend(localAgentTarget.realmAgentId, message);
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
