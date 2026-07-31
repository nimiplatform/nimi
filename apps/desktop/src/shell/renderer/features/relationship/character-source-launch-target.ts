import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
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
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type { CharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';

export type CharacterSourceLaunchInput = {
  id: string;
  displayName?: string;
  name?: string;
  handle: string;
  avatarUrl?: string | null;
  bio: string | null;
  worldId?: string | null;
  worldName?: string | null;
  sourceWorldId?: string | null;
  sourceKind?: CharacterSourceRefV3['kind'] | null;
  sourceId?: string | null;
  sourceHash?: string | null;
  runtimeSourceRef?: string | null;
  localAgentRef?: string | null;
  sourceRef?: CharacterSourceRefV3 | null;
};

function normalizeRequiredText(value: unknown, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`character source launch requires ${field}`);
  }
  return normalized;
}

async function discoverCharacterSourceLaunchTarget(
  source: CharacterSourceLaunchInput,
  ownerUserId: string,
  t: TFunction,
  sdk: DesktopRendererSdkPort,
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
  }, ownerUserId, sdk);
  if (existing.length > 1) {
    throw new Error(characterSourceAmbiguousMessage(t));
  }
  const first = existing[0];
  if (!first) {
    return null;
  }
  return toCharacterSourceLaunchTarget({
    ...source,
    runtimeSourceRef: first.runtimeSourceRef,
    localAgentRef: first.localAgentRef,
  }, ownerUserId);
}

export function toCharacterSourceLaunchTarget(
  source: CharacterSourceLaunchInput,
  ownerUserIdInput: string | null | undefined,
): AgentLocalTargetSnapshot {
  const ownerUserId = normalizeRequiredText(ownerUserIdInput, 'ownerUserId');
  const sourceRef = resolveCharacterSourceRefV3(source);
  if (!sourceRef) {
    throw new Error('character source launch requires hash-bearing sourceRef');
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
    throw new Error('character source launch requires Runtime-owned localAgentRef');
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    sourceRef,
    displayName: normalizeRequiredText(source.displayName || source.name, 'displayName'),
    handle: String(source.handle || '').trim(),
    avatarUrl: source.avatarUrl || null,
    worldId: source.sourceWorldId || source.worldId || null,
    worldName: source.worldName || null,
    bio: source.bio || null,
    ownershipType: null,
    // Character source launch inputs carry identity only, not CharacterProfile
    // content. `greeting` / `builtinDocsContext` are supplied by the live
    // Realm/SDK source projection (the chat-surface targets) and overlaid onto
    // the chat target at chat time; this launch target leaves them null.
    greeting: null,
    builtinDocsContext: null,
  };
}

export async function materializeCharacterSourceLaunchTarget(
  source: CharacterSourceLaunchInput,
  ownerUserIdInput: string | null | undefined,
  t: TFunction,
  sdk: DesktopRendererSdkPort,
): Promise<AgentLocalTargetSnapshot> {
  const ownerUserId = normalizeRequiredText(ownerUserIdInput, 'ownerUserId');
  const discovered = await discoverCharacterSourceLaunchTarget(source, ownerUserId, t, sdk);
  if (discovered) {
    return discovered;
  }
  const materialized = await materializeCharacterSourceLocalAgent(source, t, sdk);
  const sourceRef = resolveCharacterSourceRefV3(source);
  if (!sourceRef) {
    throw new Error('character source launch requires hash-bearing sourceRef');
  }
  const discoveredAfterCommit = await discoverCharacterSourceLocalAgents(
    { sourceRef },
    ownerUserId,
    sdk,
  );
  const materializedAgent = discoveredAfterCommit.find(
    (agent) => agent.localAgentRef === materialized.localAgentRef,
  );
  if (!materializedAgent) {
    throw new Error('Runtime materialization committed without a discoverable LocalAgent projection.');
  }
  return toCharacterSourceLaunchTarget({
    ...source,
    runtimeSourceRef: materializedAgent.runtimeSourceRef,
    localAgentRef: materializedAgent.localAgentRef,
  }, ownerUserId);
}
