import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import type { ProfileData } from '@renderer/features/profile/profile-model';
import type { ContactRecord } from './relationship-model';
import {
  createNimiHostRuntimeAgentLifecycleSurface,
  normalizeNimiRuntimeAgentText,
} from '@nimiplatform/sdk/runtime';
import {
  createRealmSourceMaterializationPacket,
  resolveRealmCoreSourceRef,
} from '@renderer/features/explore/realm-persona-source-materialization';
import {
  getDesktopHostRuntimeAgentClient,
  withDesktopRuntimeProtectedScopes,
} from '@renderer/infra/sdk/desktop-nimi-client-session';

type SourceContactLaunchSource = {
  id: string;
  displayName?: string;
  name?: string;
  handle: string;
  avatarUrl?: string | null;
  bio: string | null;
  isSource?: boolean;
  worldId?: string | null;
  worldName?: string | null;
  sourceWorldId?: string | null;
  sourceKind?: string | null;
  sourceId?: string | null;
  sourceContentHash?: string | null;
  runtimeSourceRef?: string | null;
  localAgentRef?: string | null;
  sourceRef?: object | null;
  sourceOwnershipType?: string | null;
  ownershipType?: string | null;
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

async function discoverSourceContactLaunchTarget(
  source: SourceContactLaunchSource,
  ownerUserId: string,
): Promise<AgentLocalTargetSnapshot | null> {
  const sourceRef = resolveRealmCoreSourceRef(source);
  const runtimeSourceRef = normalizeNimiRuntimeAgentText(source.runtimeSourceRef);
  if (!sourceRef) {
    return null;
  }
  const lifecycle = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: getDesktopHostRuntimeAgentClient,
    getSubjectUserId: () => ownerUserId,
    withScopes: withDesktopRuntimeProtectedScopes,
  });
  const existing = await lifecycle.discoverLocalAgentsBySource({
    ownerUserId,
    runtimeSourceRef,
    sourceRef,
  });
  const first = existing[0];
  if (!first) {
    return null;
  }
  return toSourceContactLaunchTarget({
    ...source,
    runtimeSourceRef: first.runtimeSourceRef,
    localAgentRef: first.localAgentRef,
  }, ownerUserId);
}

export function toSourceContactLaunchTarget(
  source: SourceContactLaunchSource,
  ownerUserIdInput: string | null | undefined,
): AgentLocalTargetSnapshot {
  if (source.isSource === false) {
    throw new Error('source conversation launch requires a Realm source contact');
  }
  const ownerUserId = normalizeRequiredText(ownerUserIdInput, 'ownerUserId');
  const sourceRef = resolveRealmCoreSourceRef(source);
  if (!sourceRef) {
    throw new Error('source conversation launch requires hash-bearing sourceRef');
  }
  const runtimeSourceRef = normalizeRequiredText(
    source.runtimeSourceRef,
    'runtimeSourceRef',
  );
  const localAgentRef = normalizeRequiredText(
    source.localAgentRef,
    'localAgentRef',
  );
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    displayName: normalizeRequiredText(source.displayName || source.name, 'displayName'),
    handle: String(source.handle || '').trim(),
    avatarUrl: source.avatarUrl || null,
    worldId: source.sourceWorldId || source.worldId || null,
    worldName: source.worldName || null,
    bio: source.bio || null,
    ownershipType: normalizeOwnershipType(source.sourceOwnershipType || source.ownershipType),
    // Contact-launch sources carry identity only, not RealmPersona profile
    // content. `greeting` / `builtinDocsContext` are supplied by the live
    // Realm/SDK source projection (the chat-surface targets) and overlaid onto
    // the chat target at chat time; a relationship-launch target leaves them null.
    greeting: null,
    builtinDocsContext: null,
  };
}

export async function materializeSourceContactLaunchTarget(
  source: SourceContactLaunchSource,
  ownerUserIdInput: string | null | undefined,
): Promise<AgentLocalTargetSnapshot> {
  const ownerUserId = normalizeRequiredText(ownerUserIdInput, 'ownerUserId');
  const discovered = await discoverSourceContactLaunchTarget(source, ownerUserId);
  if (discovered) {
    return discovered;
  }
  const packet = await createRealmSourceMaterializationPacket(source);
  const runtimeSourceRef = normalizeRequiredText(packet.runtimeSourceRef, 'runtimeSourceRef');
  const displayName = normalizeRequiredText(source.displayName || source.name, 'displayName');
  const worldId = source.sourceWorldId || source.worldId || null;
  const lifecycle = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: getDesktopHostRuntimeAgentClient,
    getSubjectUserId: () => ownerUserId,
    withScopes: withDesktopRuntimeProtectedScopes,
  });
  const initialized = await lifecycle.initializeLocalAgent({
    ownerUserId,
    runtimeSourceRef,
    displayName,
    worldId,
    sourceMaterializationPacket: packet,
  });
  return toSourceContactLaunchTarget({
    ...source,
    runtimeSourceRef,
    localAgentRef: initialized.localAgentRef,
  }, ownerUserId);
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
