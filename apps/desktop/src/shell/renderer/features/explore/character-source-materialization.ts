import { i18n } from '../../i18n';
import {
  createNimiHostRuntimeAgentLifecycleSurface,
  isRuntimeLocalAgentRef,
  normalizeNimiRuntimeAgentText,
  type NimiRuntimeAgentDiscoveredLocalAgent,
  type RuntimeMaterializeRealmSourceResult,
} from '@nimiplatform/sdk/runtime';
import {
  getDesktopHostRuntimeAgentClient,
  getDesktopRuntime,
  withDesktopRuntimeProtectedScopes,
} from '../../infra/sdk/desktop-nimi-client-session';
import {
  characterSourceRefKey,
  resolveCharacterSourceRefV3,
} from '../realm-source/realm-source-identity.js';

export {
  characterSourceRefKey,
  resolveCharacterSourceRefV3,
};

export type CharacterSourceState =
  | 'source_materialization_available'
  | 'local_agent_available'
  | 'local_agent_ambiguous'
  | 'runtime_agent_inventory_pending'
  | 'runtime_agent_inventory_unavailable'
  | 'source_materialization_unavailable';

export type CharacterPrimaryAction =
  | 'become_partner'
  | 'open_partner'
  | 'partner_ambiguous'
  | 'partner_runtime_pending'
  | 'partner_runtime_unavailable'
  | 'source_materialization_unavailable';

export type CharacterSourceStateOptions = {
  readonly runtimeInventoryPending?: boolean;
  readonly runtimeInventoryUnavailable?: boolean;
};

export type CharacterPrimaryActionLabel = {
  state: CharacterSourceState;
  action: CharacterPrimaryAction;
  label: string;
  disabled: boolean;
  hint?: string;
};

function translate(key: string, defaultValue: string): string {
  const translated = i18n.t(key, { defaultValue });
  return typeof translated === 'string' && translated.trim() ? translated : defaultValue;
}

export function characterSourceMaterializationMessage(): string {
  return translate(
    'Explore.characterSourceMaterializationUnavailable',
    'This character is missing a current CharacterSourceRefV3, so it cannot become your partner yet.',
  );
}

export function characterSourceAmbiguousMessage(): string {
  return translate(
    'Explore.characterSourceAmbiguous',
    'More than one partner already exists for this character. Open the partner from your relationship list.',
  );
}

export function characterRuntimeUnavailableMessage(): string {
  return translate(
    'Explore.characterRuntimeUnavailable',
    'Runtime is unavailable, so this character cannot become your partner right now.',
  );
}

export function characterRuntimePendingMessage(): string {
  return translate(
    'Explore.characterRuntimePending',
    'Checking whether this character is already your partner.',
  );
}

export function characterSourceMaterializationRejectedMessage(): string {
  return translate(
    'Explore.characterSourceMaterializationRejected',
    'Runtime rejected this partner handoff. Refresh the character and try again.',
  );
}

export function characterSourceMaterializationFailureMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message.trim()
    : typeof error === 'string' ? error.trim() : '';
  const normalized = message.toLowerCase();
  if (normalized.includes('binding mismatch')
    || normalized.includes('acquisition denied')
    || normalized.includes('source snapshot invalid')
    || normalized.includes('capacity exceeded')) {
    return characterSourceMaterializationRejectedMessage();
  }
  return message || characterSourceMaterializationMessage();
}

function createMaterializationRequestId(): string {
  const cryptoLike = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoLike?.randomUUID === 'function') {
    return `desktop-source-materialization:${cryptoLike.randomUUID()}`;
  }
  return `desktop-source-materialization:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export async function materializeCharacterSourceLocalAgent(
  input: unknown,
): Promise<RuntimeMaterializeRealmSourceResult> {
  const sourceRef = resolveCharacterSourceRefV3(input);
  if (!sourceRef) throw new Error(characterSourceMaterializationMessage());
  return getDesktopRuntime().materializeRealmSource({
    sourceRef,
    requestId: createMaterializationRequestId(),
  });
}

export async function discoverCharacterSourceLocalAgents(
  input: unknown,
  ownerUserIdInput: unknown,
): Promise<NimiRuntimeAgentDiscoveredLocalAgent[]> {
  const ownerUserId = normalizeNimiRuntimeAgentText(ownerUserIdInput);
  const sourceRef = resolveCharacterSourceRefV3(input);
  if (!ownerUserId || !sourceRef) return [];
  const lifecycle = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: getDesktopHostRuntimeAgentClient,
    getSubjectUserId: () => ownerUserId,
    withScopes: withDesktopRuntimeProtectedScopes,
  });
  return lifecycle.discoverLocalAgentsBySource({ ownerUserId, sourceRef });
}

export type CharacterSourceDiscoveredLocalAgent = {
  readonly localAgentRef?: string | null;
  readonly runtimeSourceRef?: string | null;
  readonly sourceKind?: string | null;
  readonly sourceWorldId?: string | null;
  readonly sourceId?: string | null;
  readonly sourceHash?: string | null;
};

function runtimeOwnedLocalAgentsForSource(
  sourceInput: unknown,
  localAgents: readonly CharacterSourceDiscoveredLocalAgent[],
): CharacterSourceDiscoveredLocalAgent[] {
  const sourceRef = resolveCharacterSourceRefV3(sourceInput);
  if (!sourceRef) return [];
  return localAgents.filter((agent) => isRuntimeLocalAgentRef(agent.localAgentRef)
    && agent.sourceKind === sourceRef.kind
    && agent.sourceWorldId === sourceRef.worldId
    && agent.sourceId === sourceRef.id
    && agent.sourceHash === sourceRef.sourceHash);
}

export function resolveCharacterSourceState(
  sourceInput: unknown,
  localAgents: readonly CharacterSourceDiscoveredLocalAgent[] = [],
  options: CharacterSourceStateOptions = {},
): CharacterSourceState {
  if (!resolveCharacterSourceRefV3(sourceInput)) return 'source_materialization_unavailable';
  if (options.runtimeInventoryUnavailable) return 'runtime_agent_inventory_unavailable';
  if (options.runtimeInventoryPending) return 'runtime_agent_inventory_pending';
  const matchingAgents = runtimeOwnedLocalAgentsForSource(sourceInput, localAgents);
  if (matchingAgents.length === 1) return 'local_agent_available';
  if (matchingAgents.length > 1) return 'local_agent_ambiguous';
  return 'source_materialization_available';
}

export function describeCharacterPrimaryAction(state: CharacterSourceState): CharacterPrimaryActionLabel {
  if (state === 'source_materialization_unavailable') {
    return { state, action: state, label: translate('Explore.characterSourceUnavailable', 'Unavailable'), disabled: true, hint: characterSourceMaterializationMessage() };
  }
  if (state === 'runtime_agent_inventory_unavailable') {
    return { state, action: 'partner_runtime_unavailable', label: translate('Explore.characterRuntimeUnavailableLabel', 'Runtime unavailable'), disabled: true, hint: characterRuntimeUnavailableMessage() };
  }
  if (state === 'runtime_agent_inventory_pending') {
    return { state, action: 'partner_runtime_pending', label: translate('Explore.characterRuntimePendingLabel', 'Checking partner'), disabled: true, hint: characterRuntimePendingMessage() };
  }
  if (state === 'local_agent_ambiguous') {
    return { state, action: 'partner_ambiguous', label: translate('Explore.characterSourceAmbiguousLabel', 'Open from partners'), disabled: true, hint: characterSourceAmbiguousMessage() };
  }
  if (state === 'local_agent_available') {
    return { state, action: 'open_partner', label: translate('Explore.characterSourceOpenLocalAgent', 'Open partner'), disabled: false };
  }
  return { state, action: 'become_partner', label: translate('Explore.characterSourceMaterialize', 'Become my partner'), disabled: false };
}
