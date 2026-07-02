import { i18n } from '@renderer/i18n';
import {
  createNimiRealmSourceMaterializationPacket,
  type NimiRealmSourceMaterializationPacket,
} from '@nimiplatform/sdk/realm';
import {
  createNimiHostRuntimeAgentLifecycleSurface,
  normalizeNimiRuntimeAgentText,
  type NimiRuntimeAgentDiscoveredLocalAgent,
} from '@nimiplatform/sdk/runtime';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';
import {
  getDesktopHostRuntimeAgentClient,
  withDesktopRuntimeProtectedScopes,
} from '@renderer/infra/sdk/desktop-nimi-client-session';
import {
  realmSourceRefKey,
  resolveRealmCoreSourceRef,
} from '@renderer/features/realm-source/realm-source-identity.js';

export {
  realmSourceRefKey,
  resolveRealmCoreSourceRef,
};

export const DESKTOP_SOURCE_MATERIALIZATION_AUDIENCE = 'nimi.desktop.local-agent.materialization';

export type RealmPersonaSourceState =
  | 'source_materialization_available'
  | 'local_agent_available'
  | 'source_materialization_unavailable';

export type RealmPersonaPrimaryAction =
  | 'materialize_source'
  | 'open_local_agent'
  | 'source_materialization_unavailable';

export type RealmPersonaPrimaryActionLabel = {
  state: RealmPersonaSourceState;
  action: RealmPersonaPrimaryAction;
  label: string;
  disabled: boolean;
};

export function realmPersonaSourceMaterializationMessage(): string {
  return i18n.t('Explore.realmPersonaSourceMaterializationUnavailable', {
    defaultValue: 'This source requires a current hash-bearing sourceRef before it can become a local agent.',
  });
}

export async function createRealmSourceMaterializationPacket(input: unknown): Promise<NimiRealmSourceMaterializationPacket> {
  const sourceRef = resolveRealmCoreSourceRef(input);
  if (!sourceRef) {
    throw new Error(realmPersonaSourceMaterializationMessage());
  }
  return callRealmApi(
    (realm) => createNimiRealmSourceMaterializationPacket(
      realm,
      emitRealmDataError,
      sourceRef,
      DESKTOP_SOURCE_MATERIALIZATION_AUDIENCE,
    ),
    'Failed to create Realm source materialization packet',
  );
}

export async function discoverRealmSourceLocalAgents(
  input: unknown,
  ownerUserIdInput: unknown,
): Promise<NimiRuntimeAgentDiscoveredLocalAgent[]> {
  const ownerUserId = normalizeNimiRuntimeAgentText(ownerUserIdInput);
  const sourceRef = resolveRealmCoreSourceRef(input);
  if (!ownerUserId || !sourceRef || typeof input !== 'object' || input === null) {
    return [];
  }
  const runtimeSourceRef = normalizeNimiRuntimeAgentText(
    (input as Readonly<Record<string, unknown>>).runtimeSourceRef,
  );
  const lifecycle = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: getDesktopHostRuntimeAgentClient,
    getSubjectUserId: () => ownerUserId,
    withScopes: withDesktopRuntimeProtectedScopes,
  });
  return lifecycle.discoverLocalAgentsBySource({
    ownerUserId,
    runtimeSourceRef,
    sourceRef,
  });
}

export type RealmSourceDiscoveredLocalAgent = {
  readonly ownerUserId?: string | null;
  readonly runtimeSourceRef?: string | null;
  readonly localAgentRef?: string | null;
  readonly sourceKind?: string | null;
  readonly sourceWorldId?: string | null;
  readonly sourceId?: string | null;
  readonly sourceContentHash?: string | null;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasRuntimeOwnedLocalAgentForSource(
  sourceInput: unknown,
  localAgents: readonly RealmSourceDiscoveredLocalAgent[],
): boolean {
  const sourceRef = resolveRealmCoreSourceRef(sourceInput);
  if (!sourceRef) {
    return false;
  }
  const sourceRecord = typeof sourceInput === 'object' && sourceInput !== null
    ? sourceInput as Readonly<Record<string, unknown>>
    : {};
  const runtimeSourceRef = normalizeText(sourceRecord.runtimeSourceRef);
  return localAgents.some((agent) => {
    const localAgentRef = normalizeText(agent.localAgentRef);
    if (!localAgentRef.startsWith('local-agent:')) {
      return false;
    }
    return (!runtimeSourceRef || normalizeText(agent.runtimeSourceRef) === runtimeSourceRef)
      && normalizeText(agent.sourceKind) === sourceRef.kind
      && normalizeText(agent.sourceWorldId) === sourceRef.worldId
      && normalizeText(agent.sourceId) === sourceRef.sourceId
      && normalizeText(agent.sourceContentHash) === sourceRef.sourceContentHash;
  });
}

export function resolveRealmPersonaSourceState(
  sourceInput: unknown,
  localAgents: readonly RealmSourceDiscoveredLocalAgent[] = [],
): RealmPersonaSourceState {
  if (!resolveRealmCoreSourceRef(sourceInput)) {
    return 'source_materialization_unavailable';
  }
  return hasRuntimeOwnedLocalAgentForSource(sourceInput, localAgents)
    ? 'local_agent_available'
    : 'source_materialization_available';
}

export function describeRealmPersonaPrimaryAction(
  state: RealmPersonaSourceState,
): RealmPersonaPrimaryActionLabel {
  if (state === 'source_materialization_unavailable') {
    return {
      state,
      action: 'source_materialization_unavailable',
      label: i18n.t('Explore.realmPersonaSourceUnavailable', { defaultValue: 'Unavailable' }),
      disabled: true,
    };
  }
  if (state === 'local_agent_available') {
    return {
      state,
      action: 'open_local_agent',
      label: i18n.t('Explore.realmPersonaSourceOpenLocalAgent', { defaultValue: 'Open local agent' }),
      disabled: false,
    };
  }
  return {
    state,
    action: 'materialize_source',
    label: i18n.t('Explore.realmPersonaSourceMaterialize', { defaultValue: 'Create local agent' }),
    disabled: false,
  };
}
