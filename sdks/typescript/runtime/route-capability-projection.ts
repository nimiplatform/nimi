import { ReasonCode } from '../types';
import type {
  NimiRuntimeResolvedBinding,
  NimiRuntimeRouteCapabilityRuntime,
  NimiRuntimeRouteDescribeResult,
  NimiRuntimeRouteHealthResult,
} from './route-capability-types';
import {
  normalizeText,
} from './route-capability-binding';
import {
  normalizeNimiRuntimeRouteCapabilityToken,
  type NimiRuntimeCanonicalCapability,
  type NimiRuntimeRouteBinding,
} from './route-options';

export const NIMI_RUNTIME_ROUTE_APP_CAPABILITIES = [
  'text.generate',
  'text.embed',
  'image.generate',
  'image.edit',
  'video.generate',
  'audio.synthesize',
  'audio.transcribe',
  'voice_workflow.voice_clone',
  'voice_workflow.voice_design',
] as const;

export type NimiRuntimeRouteAppCapability = (typeof NIMI_RUNTIME_ROUTE_APP_CAPABILITIES)[number];

export interface NimiRuntimeRouteCapabilitySelectionStore {
  readonly version: number;
  readonly selectedBindings: Partial<Record<NimiRuntimeRouteAppCapability, NimiRuntimeRouteBinding | null>>;
}

export type NimiRuntimeRouteCapabilityProjectionReasonCode =
  | 'selection_missing'
  | 'selection_cleared'
  | 'binding_unresolved'
  | 'route_not_ready'
  | 'route_unhealthy'
  | 'metadata_missing'
  | 'capability_unsupported'
  | 'host_denied';

export type NimiRuntimeRouteCapabilityProjectionIssueKind =
  | 'needs_selection'
  | 'binding_unresolved'
  | 'route_not_ready'
  | 'route_unhealthy'
  | 'metadata_missing'
  | 'capability_unsupported'
  | 'host_denied'
  | 'unknown';

export interface NimiRuntimeRouteCapabilityProjection {
  readonly capability: NimiRuntimeRouteAppCapability;
  readonly selectedBinding: NimiRuntimeRouteBinding | null;
  readonly resolvedBinding: NimiRuntimeResolvedBinding | null;
  readonly health: NimiRuntimeRouteHealthResult | null;
  readonly metadata: NimiRuntimeRouteDescribeResult | null;
  readonly supported: boolean;
  readonly reasonCode: NimiRuntimeRouteCapabilityProjectionReasonCode | null;
}

export type NimiRuntimeRouteCapabilityProjectionMap =
  Partial<Record<NimiRuntimeRouteAppCapability, NimiRuntimeRouteCapabilityProjection>>;

export interface NimiRuntimeRouteCapabilityProjectionInput {
  readonly capability: NimiRuntimeRouteAppCapability;
  readonly selectionStore: NimiRuntimeRouteCapabilitySelectionStore;
  readonly routeRuntime?: NimiRuntimeRouteCapabilityRuntime | null;
  readonly hostAllowed?: boolean;
}

const NIMI_RUNTIME_ROUTE_CAPABILITY_SELECTION_STORE_VERSION = 1;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function createNimiRuntimeRouteCapabilityProjection(
  capability: NimiRuntimeRouteAppCapability,
  overrides: Partial<NimiRuntimeRouteCapabilityProjection>,
): NimiRuntimeRouteCapabilityProjection {
  return {
    capability,
    selectedBinding: null,
    resolvedBinding: null,
    health: null,
    metadata: null,
    supported: false,
    reasonCode: null,
    ...overrides,
  };
}

function nimiRuntimeRouteCapabilityReasonCodeFromError(
  error: unknown,
): NimiRuntimeRouteCapabilityProjectionReasonCode | null {
  const record = asRecord(error);
  const reasonCode = normalizeText(record.reasonCode) || normalizeText((error as Error | null | undefined)?.message);
  const normalized = reasonCode.toUpperCase();
  if (!normalized) {
    return null;
  }
  if (
    normalized.includes('HOOK_PERMISSION_DENIED')
    || normalized.includes('ACTION_PERMISSION_DENIED')
    || normalized.includes('SANDBOX_CAPABILITY_DENIED')
  ) {
    return 'host_denied';
  }
  if (
    normalized.includes('AI_ROUTE_UNSUPPORTED')
    || normalized.includes('CAPABILITY_MISSING')
    || normalized.includes('UNSUPPORTED')
  ) {
    return 'capability_unsupported';
  }
  return null;
}

function isNimiRuntimeRouteCapabilityHealthHealthy(health: NimiRuntimeRouteHealthResult | null): boolean {
  if (!health) {
    return false;
  }
  const status = normalizeText(health.status).toLowerCase();
  if (status === 'unavailable' || status === 'unhealthy') {
    return false;
  }
  return health.healthy !== false;
}

function isNimiRuntimeRouteCapabilityHealthNotReady(
  health: NimiRuntimeRouteHealthResult | null,
  resolvedBinding: NimiRuntimeResolvedBinding | null,
): boolean {
  const reasonCode = normalizeText(health?.reasonCode).toUpperCase();
  const actionHint = normalizeText(health?.actionHint).toLowerCase();
  const detail = normalizeText(health?.detail).toLowerCase();
  const runtimeStatus = normalizeText(resolvedBinding?.goRuntimeStatus).toLowerCase();
  if (reasonCode === ReasonCode.AI_MODEL_NOT_READY) {
    return true;
  }
  if (runtimeStatus === 'installed') {
    return true;
  }
  if (
    actionHint.includes('warm local model')
    || actionHint.includes('wait for install')
    || actionHint.includes('finish local model install')
    || actionHint.includes('repair local model metadata')
  ) {
    return true;
  }
  if (
    detail.includes('setup_required')
    || detail.includes('materializable_requires_confirmation')
  ) {
    return true;
  }
  return false;
}

export function toNimiRuntimeRouteCanonicalCapability(
  capability: NimiRuntimeRouteAppCapability,
): NimiRuntimeCanonicalCapability {
  const normalized = normalizeNimiRuntimeRouteCapabilityToken(capability);
  if (!normalized) {
    throw new Error(`UNSUPPORTED_NIMI_RUNTIME_CAPABILITY:${capability}`);
  }
  return normalized;
}

export function createDefaultNimiRuntimeRouteCapabilitySelectionStore(): NimiRuntimeRouteCapabilitySelectionStore {
  return {
    version: NIMI_RUNTIME_ROUTE_CAPABILITY_SELECTION_STORE_VERSION,
    selectedBindings: {},
  };
}

export function updateNimiRuntimeRouteCapabilityBinding(
  state: NimiRuntimeRouteCapabilitySelectionStore,
  capability: NimiRuntimeRouteAppCapability,
  binding: NimiRuntimeRouteBinding | null | undefined,
): NimiRuntimeRouteCapabilitySelectionStore {
  const nextSelectedBindings = { ...state.selectedBindings };
  if (binding === undefined) {
    delete nextSelectedBindings[capability];
  } else {
    nextSelectedBindings[capability] = binding;
  }
  return {
    version: NIMI_RUNTIME_ROUTE_CAPABILITY_SELECTION_STORE_VERSION,
    selectedBindings: nextSelectedBindings,
  };
}

export function isNimiRuntimeRouteCapabilityProjectionReady(
  projection: NimiRuntimeRouteCapabilityProjection | null | undefined,
): projection is NimiRuntimeRouteCapabilityProjection & { resolvedBinding: NimiRuntimeResolvedBinding } {
  return Boolean(projection?.supported && projection.resolvedBinding);
}

export function getNimiRuntimeRouteCapabilityProjectionIssueKind(
  projection: NimiRuntimeRouteCapabilityProjection | null | undefined,
): NimiRuntimeRouteCapabilityProjectionIssueKind | null {
  if (isNimiRuntimeRouteCapabilityProjectionReady(projection)) {
    return null;
  }
  switch (projection?.reasonCode) {
    case 'selection_missing':
    case 'selection_cleared':
      return 'needs_selection';
    case 'binding_unresolved':
      return 'binding_unresolved';
    case 'route_not_ready':
      return 'route_not_ready';
    case 'route_unhealthy':
      return 'route_unhealthy';
    case 'metadata_missing':
      return 'metadata_missing';
    case 'capability_unsupported':
      return 'capability_unsupported';
    case 'host_denied':
      return 'host_denied';
    default:
      return 'unknown';
  }
}

export function isNimiRuntimeRouteCapabilityProjectionSelectionRequired(
  projection: NimiRuntimeRouteCapabilityProjection | null | undefined,
): boolean {
  return getNimiRuntimeRouteCapabilityProjectionIssueKind(projection) === 'needs_selection';
}

export async function buildNimiRuntimeRouteCapabilityProjection(
  input: NimiRuntimeRouteCapabilityProjectionInput,
): Promise<NimiRuntimeRouteCapabilityProjection> {
  const routeRuntime = input.routeRuntime || null;
  const hostAllowed = input.hostAllowed !== false;
  if (!hostAllowed) {
    return createNimiRuntimeRouteCapabilityProjection(input.capability, { reasonCode: 'host_denied' });
  }

  const selectedBindings = input.selectionStore.selectedBindings;
  const hasSelection = hasOwn(selectedBindings, input.capability);
  if (!hasSelection) {
    return createNimiRuntimeRouteCapabilityProjection(input.capability, { reasonCode: 'selection_missing' });
  }

  const selectedBinding = selectedBindings[input.capability];
  if (selectedBinding === null) {
    return createNimiRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding: null,
      reasonCode: 'selection_cleared',
    });
  }

  if (!selectedBinding) {
    return createNimiRuntimeRouteCapabilityProjection(input.capability, { reasonCode: 'binding_unresolved' });
  }

  if (!routeRuntime) {
    return createNimiRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding,
      reasonCode: 'binding_unresolved',
    });
  }

  let resolvedBinding: NimiRuntimeResolvedBinding;
  try {
    resolvedBinding = await routeRuntime.resolve({
      capability: input.capability,
      binding: selectedBinding,
    });
  } catch (error) {
    const mappedReasonCode = nimiRuntimeRouteCapabilityReasonCodeFromError(error);
    return createNimiRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding,
      reasonCode: mappedReasonCode || 'binding_unresolved',
    });
  }
  if (!resolvedBinding?.resolvedBindingRef) {
    return createNimiRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding,
      resolvedBinding,
      reasonCode: 'binding_unresolved',
    });
  }

  let health: NimiRuntimeRouteHealthResult;
  try {
    health = await routeRuntime.checkHealth({
      capability: input.capability,
      binding: selectedBinding,
    });
  } catch (error) {
    const mappedReasonCode = nimiRuntimeRouteCapabilityReasonCodeFromError(error);
    return createNimiRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding,
      resolvedBinding,
      reasonCode: mappedReasonCode || 'route_unhealthy',
    });
  }
  if (!isNimiRuntimeRouteCapabilityHealthHealthy(health)) {
    return createNimiRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding,
      resolvedBinding,
      health,
      reasonCode: isNimiRuntimeRouteCapabilityHealthNotReady(health, resolvedBinding)
        ? 'route_not_ready'
        : 'route_unhealthy',
    });
  }

  const expectedMetadataCapability = toNimiRuntimeRouteCanonicalCapability(input.capability);
  let metadata: NimiRuntimeRouteDescribeResult;
  try {
    metadata = await routeRuntime.describe({
      capability: expectedMetadataCapability,
      resolvedBindingRef: resolvedBinding.resolvedBindingRef,
    });
  } catch (error) {
    const mappedReasonCode = nimiRuntimeRouteCapabilityReasonCodeFromError(error);
    return createNimiRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding,
      resolvedBinding,
      health,
      reasonCode: mappedReasonCode === 'host_denied' ? 'host_denied' : 'metadata_missing',
    });
  }
  if (!metadata || metadata.capability !== expectedMetadataCapability || metadata.metadataKind !== expectedMetadataCapability) {
    return createNimiRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding,
      resolvedBinding,
      health,
      reasonCode: 'metadata_missing',
    });
  }

  return createNimiRuntimeRouteCapabilityProjection(input.capability, {
    selectedBinding,
    resolvedBinding,
    health,
    metadata,
    supported: true,
    reasonCode: null,
  });
}

export async function buildNimiRuntimeRouteCapabilityProjectionMap(input: {
  readonly selectionStore: NimiRuntimeRouteCapabilitySelectionStore;
  readonly routeRuntime?: NimiRuntimeRouteCapabilityRuntime | null;
  readonly hostAllowlist?: Partial<Record<NimiRuntimeRouteAppCapability, boolean>>;
  readonly capabilities?: readonly NimiRuntimeRouteAppCapability[];
}): Promise<NimiRuntimeRouteCapabilityProjectionMap> {
  const capabilities = input.capabilities || NIMI_RUNTIME_ROUTE_APP_CAPABILITIES;
  const entries = await Promise.all(capabilities.map(async (capability) => {
    const projection = await buildNimiRuntimeRouteCapabilityProjection({
      capability,
      selectionStore: input.selectionStore,
      routeRuntime: input.routeRuntime,
      hostAllowed: input.hostAllowlist?.[capability] !== false,
    });
    return [capability, projection] as const;
  }));
  return Object.fromEntries(entries) as NimiRuntimeRouteCapabilityProjectionMap;
}
