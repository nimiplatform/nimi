import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
import type { ProfileData } from '../profile/profile-model';
import type { ContactRecord } from './relationship-model';
import {
  isRuntimeLocalAgentRef,
  normalizeNimiRuntimeAgentText,
} from '@nimiplatform/sdk/runtime';
import {
  characterSourceAmbiguousMessage,
  discoverCharacterSourceLocalAgents,
  materializeCharacterSourceLocalAgent,
  resolveCharacterSourceRefV3,
} from '../explore/character-source-materialization';
import type { TFunction } from 'i18next';

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
  sourceHash?: string | null;
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
  t: TFunction,
): Promise<AgentLocalTargetSnapshot | null> {
  const sourceRef = resolveCharacterSourceRefV3(source);
  const runtimeSourceRef = normalizeNimiRuntimeAgentText(source.runtimeSourceRef);
  if (!sourceRef) {
    return null;
  }
  const existing = await discoverCharacterSourceLocalAgents({
    ...source,
    runtimeSourceRef,
    sourceRef,
  }, ownerUserId);
  if (existing.length > 1) {
    throw new Error(characterSourceAmbiguousMessage(t));
  }
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
  const sourceRef = resolveCharacterSourceRefV3(source);
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
  if (!isRuntimeLocalAgentRef(localAgentRef)) {
    throw new Error('source conversation launch requires Runtime-owned localAgentRef');
  }
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
    // Contact-launch sources carry identity only, not PersonaCharacter profile
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
  t: TFunction,
): Promise<AgentLocalTargetSnapshot> {
  const ownerUserId = normalizeRequiredText(ownerUserIdInput, 'ownerUserId');
  const discovered = await discoverSourceContactLaunchTarget(source, ownerUserId, t);
  if (discovered) {
    return discovered;
  }
  const materialized = await materializeCharacterSourceLocalAgent(source, t);
  const discoveredAfterCommit = await discoverCharacterSourceLocalAgents(source, ownerUserId);
  const materializedAgent = discoveredAfterCommit.find(
    (agent) => agent.localAgentRef === materialized.localAgentRef,
  );
  if (!materializedAgent) {
    throw new Error('Runtime materialization committed without a discoverable LocalAgent projection.');
  }
  return toSourceContactLaunchTarget({
    ...source,
    runtimeSourceRef: materializedAgent.runtimeSourceRef,
    localAgentRef: materializedAgent.localAgentRef,
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
