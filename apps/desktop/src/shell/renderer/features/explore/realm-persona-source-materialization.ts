import { i18n } from '@renderer/i18n';
import {
  createNimiHostRuntimeAgentLifecycleSurface,
  createNimiHostRuntimeAgentMaterializationSurface,
  isRuntimeLocalAgentRef,
  normalizeNimiRuntimeAgentText,
  type NimiRuntimeAgentDiscoveredLocalAgent,
  type NimiRuntimeAgentMaterializedRealmSource,
} from '@nimiplatform/sdk/runtime';
import { emitRealmDataError } from '@renderer/infra/realm/realm-api';
import {
  getDesktopAccountRuntime,
  getDesktopAppId,
  getDesktopRealm,
  getDesktopHostRuntimeAgentClient,
  getDesktopRuntime,
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

export type RealmPersonaSourceState =
  | 'source_materialization_available'
  | 'local_agent_available'
  | 'local_agent_ambiguous'
  | 'runtime_agent_inventory_pending'
  | 'runtime_agent_inventory_unavailable'
  | 'source_materialization_unavailable';

export type RealmPersonaPrimaryAction =
  | 'become_partner'
  | 'open_partner'
  | 'partner_ambiguous'
  | 'partner_runtime_pending'
  | 'partner_runtime_unavailable'
  | 'source_materialization_unavailable';

export type RealmPersonaSourceStateOptions = {
  readonly runtimeInventoryPending?: boolean;
  readonly runtimeInventoryUnavailable?: boolean;
};

export type RealmPersonaPrimaryActionLabel = {
  state: RealmPersonaSourceState;
  action: RealmPersonaPrimaryAction;
  label: string;
  disabled: boolean;
  hint?: string;
};

function translate(key: string, defaultValue: string): string {
  const translated = i18n.t(key, { defaultValue });
  return typeof translated === 'string' && translated.trim() ? translated : defaultValue;
}

export function realmPersonaSourceMaterializationMessage(): string {
  return translate(
    'Explore.realmPersonaSourceMaterializationUnavailable',
    'This character is missing a current hash-bearing sourceRef, so it cannot become your partner yet.',
  );
}

export function realmPersonaSourceAmbiguousMessage(): string {
  return translate(
    'Explore.realmPersonaSourceAmbiguous',
    'More than one partner already exists for this character. Open the partner from your relationship list.',
  );
}

export function realmPersonaRuntimeUnavailableMessage(): string {
  return translate(
    'Explore.realmPersonaRuntimeUnavailable',
    'Runtime is unavailable, so this character cannot become your partner right now.',
  );
}

export function realmPersonaRuntimePendingMessage(): string {
  return translate(
    'Explore.realmPersonaRuntimePending',
    'Checking whether this character is already your partner.',
  );
}

export function realmPersonaSourceMaterializationVerifierUnavailableMessage(): string {
  return translate(
    'Explore.realmPersonaSourceMaterializationVerifierUnavailable',
    'Runtime materialization verification is not configured, so this character cannot become your partner on this device yet.',
  );
}

export function realmPersonaSourceMaterializationRejectedMessage(): string {
  return translate(
    'Explore.realmPersonaSourceMaterializationRejected',
    'Runtime rejected this partner handoff. Refresh the character and try again.',
  );
}

export function realmPersonaSourceMaterializationFailureMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message.trim()
    : typeof error === 'string'
      ? error.trim()
      : '';
  const normalized = message.toLowerCase();
  if (normalized.includes('source materialization packet verifier is not configured')) {
    return realmPersonaSourceMaterializationVerifierUnavailableMessage();
  }
  if (
    normalized.includes('source materialization packet is expired')
    || normalized.includes('source materialization packet proof mismatch')
    || normalized.includes('source materialization packet hash mismatch')
    || normalized.includes('source materialization packet nonce was already consumed')
  ) {
    return realmPersonaSourceMaterializationRejectedMessage();
  }
  return message || realmPersonaSourceMaterializationMessage();
}

function createMaterializationRequestId(): string {
  const cryptoLike = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoLike?.randomUUID === 'function') {
    return `desktop-source-materialization:${cryptoLike.randomUUID()}`;
  }
  return `desktop-source-materialization:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export async function materializeRealmSourceLocalAgent(
  input: unknown,
  ownerUserIdInput: unknown,
): Promise<NimiRuntimeAgentMaterializedRealmSource> {
  const sourceRef = resolveRealmCoreSourceRef(input);
  const ownerUserId = normalizeNimiRuntimeAgentText(ownerUserIdInput);
  if (!sourceRef) {
    throw new Error(realmPersonaSourceMaterializationMessage());
  }
  if (!ownerUserId) {
    throw new Error('Realm source materialization requires an authenticated Runtime owner.');
  }
  const materialization = createNimiHostRuntimeAgentMaterializationSurface({
    getRuntime: () => ({
      appId: getDesktopAppId(),
      auth: getDesktopAccountRuntime().auth,
      agent: getDesktopRuntime().agents,
    }),
    getSubjectUserId: () => ownerUserId,
    withScopes: withDesktopRuntimeProtectedScopes,
  });
  return materialization.materializeRealmSource({
    sourceRef,
    requestId: createMaterializationRequestId(),
    realm: getDesktopRealm(),
    emitRealmDataError,
  });
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

function runtimeOwnedLocalAgentsForSource(
  sourceInput: unknown,
  localAgents: readonly RealmSourceDiscoveredLocalAgent[],
): RealmSourceDiscoveredLocalAgent[] {
  const sourceRef = resolveRealmCoreSourceRef(sourceInput);
  if (!sourceRef) {
    return [];
  }
  const sourceRecord = typeof sourceInput === 'object' && sourceInput !== null
    ? sourceInput as Readonly<Record<string, unknown>>
    : {};
  const runtimeSourceRef = normalizeText(sourceRecord.runtimeSourceRef);
  return localAgents.filter((agent) => {
    const localAgentRef = normalizeText(agent.localAgentRef);
    if (!isRuntimeLocalAgentRef(localAgentRef)) {
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
  options: RealmPersonaSourceStateOptions = {},
): RealmPersonaSourceState {
  if (!resolveRealmCoreSourceRef(sourceInput)) {
    return 'source_materialization_unavailable';
  }
  if (options.runtimeInventoryUnavailable) {
    return 'runtime_agent_inventory_unavailable';
  }
  if (options.runtimeInventoryPending) {
    return 'runtime_agent_inventory_pending';
  }
  const matchingAgents = runtimeOwnedLocalAgentsForSource(sourceInput, localAgents);
  if (matchingAgents.length === 1) {
    return 'local_agent_available';
  }
  if (matchingAgents.length > 1) {
    return 'local_agent_ambiguous';
  }
  return 'source_materialization_available';
}

export function describeRealmPersonaPrimaryAction(
  state: RealmPersonaSourceState,
): RealmPersonaPrimaryActionLabel {
  if (state === 'source_materialization_unavailable') {
    return {
      state,
      action: 'source_materialization_unavailable',
      label: translate('Explore.realmPersonaSourceUnavailable', 'Unavailable'),
      disabled: true,
      hint: realmPersonaSourceMaterializationMessage(),
    };
  }
  if (state === 'runtime_agent_inventory_unavailable') {
    return {
      state,
      action: 'partner_runtime_unavailable',
      label: translate('Explore.realmPersonaRuntimeUnavailableLabel', 'Runtime unavailable'),
      disabled: true,
      hint: realmPersonaRuntimeUnavailableMessage(),
    };
  }
  if (state === 'runtime_agent_inventory_pending') {
    return {
      state,
      action: 'partner_runtime_pending',
      label: translate('Explore.realmPersonaRuntimePendingLabel', 'Checking partner'),
      disabled: true,
      hint: realmPersonaRuntimePendingMessage(),
    };
  }
  if (state === 'local_agent_ambiguous') {
    return {
      state,
      action: 'partner_ambiguous',
      label: translate('Explore.realmPersonaSourceAmbiguousLabel', 'Open from partners'),
      disabled: true,
      hint: realmPersonaSourceAmbiguousMessage(),
    };
  }
  if (state === 'local_agent_available') {
    return {
      state,
      action: 'open_partner',
      label: translate('Explore.realmPersonaSourceOpenLocalAgent', 'Open partner'),
      disabled: false,
    };
  }
  return {
    state,
    action: 'become_partner',
    label: translate('Explore.realmPersonaSourceMaterialize', 'Become my partner'),
    disabled: false,
  };
}
