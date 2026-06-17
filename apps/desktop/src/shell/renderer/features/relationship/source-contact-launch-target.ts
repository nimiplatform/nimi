import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import type { ProfileData } from '@renderer/features/profile/profile-model';
import type { ContactRecord } from './relationship-model';
import { buildRuntimeLocalAgentRef } from '@nimiplatform/sdk/runtime';

type SourceContactLaunchSource = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  isSource: boolean;
  worldId?: string | null;
  worldName?: string | null;
  sourceWorldId?: string | null;
  sourceOwnershipType?: string | null;
};

function normalizeRequiredText(value: unknown, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`source conversation launch requires ${field}`);
  }
  return normalized;
}

function normalizeOwnershipType(value: unknown): AgentLocalTargetSnapshot['ownershipType'] {
  const normalized = String(value || '').trim();
  if (normalized === 'MASTER_OWNED' || normalized === 'WORLD_OWNED') {
    return normalized;
  }
  return null;
}

export function toSourceContactLaunchTarget(
  source: SourceContactLaunchSource,
  ownerUserIdInput: string | null | undefined,
): AgentLocalTargetSnapshot {
  if (!source.isSource) {
    throw new Error('source conversation launch requires a Realm source contact');
  }
  const ownerUserId = normalizeRequiredText(ownerUserIdInput, 'ownerUserId');
  const runtimeSourceRef = normalizeRequiredText(source.id, 'runtimeSourceRef');
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef: buildRuntimeLocalAgentRef({ ownerUserId, runtimeSourceRef }),
    displayName: normalizeRequiredText(source.displayName, 'displayName'),
    handle: String(source.handle || '').trim(),
    avatarUrl: source.avatarUrl || null,
    worldId: source.sourceWorldId || source.worldId || null,
    worldName: source.worldName || null,
    bio: source.bio || null,
    ownershipType: normalizeOwnershipType(source.sourceOwnershipType),
    // Contact-launch sources carry identity only, not RealmPersona profile
    // content. `greeting` / `builtinDocsContext` are supplied by the live
    // Realm/SDK source projection (the chat-surface targets) and overlaid onto
    // the chat target at chat time; a relationship-launch target leaves them null.
    greeting: null,
    builtinDocsContext: null,
  };
}

export function toSourceContactLaunchTargetFromContact(
  contact: ContactRecord,
  ownerUserId: string | null | undefined,
): AgentLocalTargetSnapshot {
  return toSourceContactLaunchTarget(contact, ownerUserId);
}

export function toSourceContactLaunchTargetFromProfile(
  profile: ProfileData,
  ownerUserId: string | null | undefined,
): AgentLocalTargetSnapshot {
  return toSourceContactLaunchTarget(profile, ownerUserId);
}
