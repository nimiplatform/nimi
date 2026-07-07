import {
  MemoryBankScope,
  type MemoryBankLocator,
  type MemoryEmbeddingProfile,
  type RequestMemoryEmbeddingRuntimeBindResponse,
  type RequestMemoryEmbeddingRuntimeCutoverResponse,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import { normalizeNimiRuntimeReasonCode } from './reason-messages';
import type { NimiRuntimeRouteOptionsSnapshot } from './route-options';
import type {
  NimiMemoryEmbeddingBindingRef,
  NimiMemoryEmbeddingBindOutcome,
  NimiMemoryEmbeddingBindResult,
  NimiMemoryEmbeddingCanonicalBankStatus,
  NimiMemoryEmbeddingConfig,
  NimiMemoryEmbeddingCutoverOutcome,
  NimiMemoryEmbeddingCutoverResult,
  NimiMemoryEmbeddingResolutionState,
  NimiMemoryEmbeddingRuntimeState,
  NimiMemoryEmbeddingRuntimeTargetRef,
  NimiMemoryEmbeddingScopeRef,
  NimiMemoryEmbeddingSourceKind,
} from './memory-embedding-types';

export type NimiMemoryEmbeddingRouteAvailabilityState = 'unconfigured' | 'ready' | 'unavailable';
export type NimiMemoryEmbeddingRouteAvailabilityReason =
  | 'binding_missing'
  | 'source_binding_mismatch'
  | 'route_options_unavailable'
  | 'route_options_capability_mismatch'
  | 'cloud_model_available'
  | 'cloud_model_unavailable'
  | 'local_model_active'
  | 'local_model_unavailable';

export interface NimiMemoryEmbeddingRouteAvailabilityProjection {
  readonly state: NimiMemoryEmbeddingRouteAvailabilityState;
  readonly reason: NimiMemoryEmbeddingRouteAvailabilityReason;
  readonly sourceKind: NimiMemoryEmbeddingSourceKind | null;
  readonly bindingRef: NimiMemoryEmbeddingBindingRef | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function buildNimiMemoryEmbeddingAgentCoreLocator(
  targetRef: NimiMemoryEmbeddingRuntimeTargetRef,
): MemoryBankLocator {
  const agentId = normalizeText(targetRef.localAgentRef);
  if (!agentId) {
    throw createNimiError({
      message: 'Memory embedding agent-core target requires localAgentRef.',
      reasonCode: 'SDK_MEMORY_EMBEDDING_TARGET_INVALID',
      actionHint: 'provide_memory_embedding_agent_ref',
      source: 'sdk',
    });
  }
  return {
    scope: MemoryBankScope.AGENT_CORE,
    owner: {
      oneofKind: 'agentCore',
      agentCore: { agentId },
    },
  };
}

export function normalizeNimiMemoryEmbeddingSourceKind(value: unknown): NimiMemoryEmbeddingSourceKind | null {
  switch (normalizeText(value)) {
    case 'cloud':
      return 'cloud';
    case 'local':
      return 'local';
    default:
      return null;
  }
}

export function normalizeNimiMemoryEmbeddingResolutionState(value: unknown): NimiMemoryEmbeddingResolutionState {
  switch (normalizeText(value)) {
    case 'missing':
    case 'resolved':
    case 'unresolved':
    case 'unavailable':
      return normalizeText(value) as NimiMemoryEmbeddingResolutionState;
    default:
      return 'unavailable';
  }
}

export function normalizeNimiMemoryEmbeddingCanonicalBankStatus(value: unknown): NimiMemoryEmbeddingCanonicalBankStatus {
  switch (normalizeText(value)) {
    case 'unbound':
    case 'bound_equivalent':
    case 'bound_profile_mismatch':
    case 'rebuild_pending':
    case 'cutover_ready':
      return normalizeText(value) as NimiMemoryEmbeddingCanonicalBankStatus;
    default:
      return 'unbound';
  }
}

export function normalizeNimiMemoryEmbeddingBindOutcome(value: unknown): NimiMemoryEmbeddingBindOutcome {
  switch (normalizeText(value)) {
    case 'bound':
    case 'already_bound':
    case 'staged_rebuild':
    case 'rejected':
      return normalizeText(value) as NimiMemoryEmbeddingBindOutcome;
    default:
      return 'rejected';
  }
}

export function normalizeNimiMemoryEmbeddingCutoverOutcome(value: unknown): NimiMemoryEmbeddingCutoverOutcome {
  switch (normalizeText(value)) {
    case 'cutover_committed':
    case 'already_current':
    case 'not_ready':
    case 'rejected':
      return normalizeText(value) as NimiMemoryEmbeddingCutoverOutcome;
    default:
      return 'rejected';
  }
}

export function nimiMemoryEmbeddingProfileIdentity(profile: MemoryEmbeddingProfile | undefined): string | null {
  if (!profile) {
    return null;
  }
  const parts = [profile.provider, profile.modelId, profile.version]
    .map((part) => normalizeText(part))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(':') : null;
}

export function projectNimiMemoryEmbeddingRuntimeState(result: {
  readonly textEmbedIntentPresent: boolean;
  readonly textEmbedSourceKind: string;
  readonly configRevision?: string | number;
  readonly resolutionState: string;
  readonly resolvedProfile?: MemoryEmbeddingProfile;
  readonly canonicalBankStatus: string;
  readonly blockedReasonCode: unknown;
  readonly operationReadiness?: { readonly bindAllowed?: boolean; readonly cutoverAllowed?: boolean };
}): NimiMemoryEmbeddingRuntimeState {
  const revision = Number(normalizeText(result.configRevision));
  return {
    textEmbedIntentPresent: result.textEmbedIntentPresent,
    textEmbedSourceKind: normalizeNimiMemoryEmbeddingSourceKind(result.textEmbedSourceKind),
    configRevision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    resolutionState: normalizeNimiMemoryEmbeddingResolutionState(result.resolutionState),
    resolvedProfileIdentity: nimiMemoryEmbeddingProfileIdentity(result.resolvedProfile),
    canonicalBankStatus: normalizeNimiMemoryEmbeddingCanonicalBankStatus(result.canonicalBankStatus),
    blockedReasonCode: normalizeNimiRuntimeReasonCode(result.blockedReasonCode) || null,
    operationReadiness: {
      bindAllowed: Boolean(result.operationReadiness?.bindAllowed),
      cutoverAllowed: Boolean(result.operationReadiness?.cutoverAllowed),
    },
  };
}

export function projectNimiMemoryEmbeddingBindResult(
  result: RequestMemoryEmbeddingRuntimeBindResponse,
): NimiMemoryEmbeddingBindResult {
  return {
    outcome: normalizeNimiMemoryEmbeddingBindOutcome(result.outcome),
    blockedReasonCode: normalizeNimiRuntimeReasonCode(result.blockedReasonCode) || null,
    canonicalBankStatusAfter: normalizeNimiMemoryEmbeddingCanonicalBankStatus(result.canonicalBankStatusAfter),
    pendingCutover: result.pendingCutover,
  };
}

export function projectNimiMemoryEmbeddingCutoverResult(
  result: RequestMemoryEmbeddingRuntimeCutoverResponse,
): NimiMemoryEmbeddingCutoverResult {
  return {
    outcome: normalizeNimiMemoryEmbeddingCutoverOutcome(result.outcome),
    blockedReasonCode: normalizeNimiRuntimeReasonCode(result.blockedReasonCode) || null,
    canonicalBankStatusAfter: normalizeNimiMemoryEmbeddingCanonicalBankStatus(result.canonicalBankStatusAfter),
  };
}

export function projectUnavailableNimiMemoryEmbeddingRuntimeState(
  blockedReasonCode = 'RUNTIME_UNAVAILABLE',
): NimiMemoryEmbeddingRuntimeState {
  return {
    textEmbedIntentPresent: false,
    textEmbedSourceKind: null,
    configRevision: 0,
    resolutionState: 'unavailable',
    resolvedProfileIdentity: null,
    canonicalBankStatus: 'unbound',
    blockedReasonCode,
    operationReadiness: { bindAllowed: false, cutoverAllowed: false },
  };
}

function memoryEmbeddingLocalBindingRefValue(bindingRef: Extract<NimiMemoryEmbeddingBindingRef, { kind: 'local' }>): string {
  return normalizeText(bindingRef.profileBindingId) || normalizeText(bindingRef.readinessRef);
}

export function projectNimiMemoryEmbeddingRouteAvailability(input: {
  readonly config: NimiMemoryEmbeddingConfig;
  readonly routeOptions?: NimiRuntimeRouteOptionsSnapshot | null;
}): NimiMemoryEmbeddingRouteAvailabilityProjection {
  const sourceKind = input.config.sourceKind;
  const bindingRef = input.config.bindingRef;
  if (!sourceKind || !bindingRef) {
    return { state: 'unconfigured', reason: 'binding_missing', sourceKind: null, bindingRef: null };
  }
  if (sourceKind !== bindingRef.kind) {
    return { state: 'unavailable', reason: 'source_binding_mismatch', sourceKind, bindingRef };
  }
  const routeOptions = input.routeOptions;
  if (!routeOptions) {
    return { state: 'unavailable', reason: 'route_options_unavailable', sourceKind, bindingRef };
  }
  if (normalizeText(routeOptions.capability) !== 'text.embed') {
    return { state: 'unavailable', reason: 'route_options_capability_mismatch', sourceKind, bindingRef };
  }
  if (bindingRef.kind === 'cloud') {
    const available = routeOptions.inventory.targets.some((item) => (
      item.targetRef.kind === 'cloud-connector'
      && item.targetRef.connectorId === bindingRef.connectorId
      && item.targetRef.remoteModelCatalogId === bindingRef.remoteModelCatalogId
      && item.targetRef.providerModelId === bindingRef.providerModelId
    ));
    return {
      state: available ? 'ready' : 'unavailable',
      reason: available ? 'cloud_model_available' : 'cloud_model_unavailable',
      sourceKind,
      bindingRef,
    };
  }
  const targetRef = memoryEmbeddingLocalBindingRefValue(bindingRef);
  const model = routeOptions.inventory.targets.find((item) => (
    item.targetRef.kind === 'local-runtime'
    && (
      normalizeText(item.targetRef.profileBindingId) === targetRef
      || normalizeText(item.targetRef.readinessRef) === targetRef
      || (item.evidence.source === 'local-runtime' && normalizeText(item.evidence.localAssetId) === targetRef)
    )
  ));
  const active = normalizeText(model?.readiness.status).toLowerCase() === 'active';
  return {
    state: active ? 'ready' : 'unavailable',
    reason: active ? 'local_model_active' : 'local_model_unavailable',
    sourceKind,
    bindingRef,
  };
}
