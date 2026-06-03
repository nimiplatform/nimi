import type {
  RuntimeCanonicalCapability,
  RuntimeResolvedBinding,
  RuntimeRouteBinding,
  RuntimeRouteDescribeResult,
} from './runtime-route-core.js';
import type {
  RuntimeRouteHealthResult,
} from './runtime-route-types.js';
import {
  normalizeRuntimeRouteCapabilityToken,
} from './runtime-route-options.js';

export const RUNTIME_ROUTE_APP_CAPABILITIES = [
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

export type RuntimeRouteAppCapability = (typeof RUNTIME_ROUTE_APP_CAPABILITIES)[number];

export type RuntimeRouteCapabilitySelectionStore = {
  version: number;
  selectedBindings: Partial<Record<RuntimeRouteAppCapability, RuntimeRouteBinding | null>>;
};

export type RuntimeRouteCapabilityProjectionReasonCode =
  | 'selection_missing'
  | 'selection_cleared'
  | 'binding_unresolved'
  | 'route_not_ready'
  | 'route_unhealthy'
  | 'metadata_missing'
  | 'capability_unsupported'
  | 'host_denied';

export type RuntimeRouteCapabilityProjectionIssueKind =
  | 'needs_selection'
  | 'binding_unresolved'
  | 'route_not_ready'
  | 'route_unhealthy'
  | 'metadata_missing'
  | 'capability_unsupported'
  | 'host_denied'
  | 'unknown';

export type RuntimeRouteCapabilityProjection = {
  capability: RuntimeRouteAppCapability;
  selectedBinding: RuntimeRouteBinding | null;
  resolvedBinding: RuntimeResolvedBinding | null;
  health: RuntimeRouteHealthResult | null;
  metadata: RuntimeRouteDescribeResult | null;
  supported: boolean;
  reasonCode: RuntimeRouteCapabilityProjectionReasonCode | null;
};

export type RuntimeRouteCapabilityProjectionMap =
  Partial<Record<RuntimeRouteAppCapability, RuntimeRouteCapabilityProjection>>;

export type RuntimeRouteCapabilityRuntime = {
  resolve(input: {
    capability: RuntimeRouteAppCapability;
    binding?: RuntimeRouteBinding;
  }): Promise<RuntimeResolvedBinding>;
  checkHealth(input: {
    capability: RuntimeRouteAppCapability;
    binding?: RuntimeRouteBinding;
  }): Promise<RuntimeRouteHealthResult>;
  describe(input: {
    capability: RuntimeRouteAppCapability;
    resolvedBindingRef: string;
  }): Promise<RuntimeRouteDescribeResult>;
};

export type BuildRuntimeRouteCapabilityProjectionInput = {
  capability: RuntimeRouteAppCapability;
  selectionStore: RuntimeRouteCapabilitySelectionStore;
  routeRuntime?: RuntimeRouteCapabilityRuntime | null;
  hostAllowed?: boolean;
};

const RUNTIME_ROUTE_CAPABILITY_SELECTION_STORE_VERSION = 1;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function createRuntimeRouteCapabilityProjection(
  capability: RuntimeRouteAppCapability,
  overrides: Partial<RuntimeRouteCapabilityProjection>,
): RuntimeRouteCapabilityProjection {
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

function runtimeRouteCapabilityReasonCodeFromError(
  error: unknown,
): RuntimeRouteCapabilityProjectionReasonCode | null {
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

function isRuntimeRouteCapabilityHealthHealthy(health: RuntimeRouteHealthResult | null): boolean {
  if (!health) {
    return false;
  }
  const status = normalizeText(health.status).toLowerCase();
  if (status === 'unavailable' || status === 'unhealthy') {
    return false;
  }
  return health.healthy !== false;
}

function isRuntimeRouteCapabilityHealthNotReady(
  health: RuntimeRouteHealthResult | null,
  resolvedBinding: RuntimeResolvedBinding | null,
): boolean {
  const reasonCode = normalizeText(health?.reasonCode).toUpperCase();
  const actionHint = normalizeText(health?.actionHint).toLowerCase();
  const detail = normalizeText(health?.detail).toLowerCase();
  const runtimeStatus = normalizeText(resolvedBinding?.goRuntimeStatus).toLowerCase();
  if (reasonCode === 'AI_MODEL_NOT_READY') {
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

export function toRuntimeRouteCanonicalCapability(capability: RuntimeRouteAppCapability): RuntimeCanonicalCapability {
  const normalized = normalizeRuntimeRouteCapabilityToken(capability);
  if (!normalized) {
    throw new Error(`UNSUPPORTED_RUNTIME_CAPABILITY:${capability}`);
  }
  return normalized;
}

export function createDefaultRuntimeRouteCapabilitySelectionStore(): RuntimeRouteCapabilitySelectionStore {
  return {
    version: RUNTIME_ROUTE_CAPABILITY_SELECTION_STORE_VERSION,
    selectedBindings: {},
  };
}

export function updateRuntimeRouteCapabilityBinding(
  state: RuntimeRouteCapabilitySelectionStore,
  capability: RuntimeRouteAppCapability,
  binding: RuntimeRouteBinding | null | undefined,
): RuntimeRouteCapabilitySelectionStore {
  const next: RuntimeRouteCapabilitySelectionStore = {
    version: RUNTIME_ROUTE_CAPABILITY_SELECTION_STORE_VERSION,
    selectedBindings: { ...state.selectedBindings },
  };
  if (binding === undefined) {
    delete next.selectedBindings[capability];
  } else {
    next.selectedBindings[capability] = binding;
  }
  return next;
}

export function isRuntimeRouteCapabilityProjectionReady(
  projection: RuntimeRouteCapabilityProjection | null | undefined,
): projection is RuntimeRouteCapabilityProjection & { resolvedBinding: RuntimeResolvedBinding } {
  return Boolean(projection?.supported && projection.resolvedBinding);
}

export function getRuntimeRouteCapabilityProjectionIssueKind(
  projection: RuntimeRouteCapabilityProjection | null | undefined,
): RuntimeRouteCapabilityProjectionIssueKind | null {
  if (isRuntimeRouteCapabilityProjectionReady(projection)) {
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

export function isRuntimeRouteCapabilityProjectionSelectionRequired(
  projection: RuntimeRouteCapabilityProjection | null | undefined,
): boolean {
  return getRuntimeRouteCapabilityProjectionIssueKind(projection) === 'needs_selection';
}

export async function buildRuntimeRouteCapabilityProjection(
  input: BuildRuntimeRouteCapabilityProjectionInput,
): Promise<RuntimeRouteCapabilityProjection> {
  const routeRuntime = input.routeRuntime || null;
  const hostAllowed = input.hostAllowed !== false;
  if (!hostAllowed) {
    return createRuntimeRouteCapabilityProjection(input.capability, { reasonCode: 'host_denied' });
  }

  const selectedBindings = input.selectionStore.selectedBindings;
  const hasSelection = hasOwn(selectedBindings, input.capability);
  if (!hasSelection) {
    return createRuntimeRouteCapabilityProjection(input.capability, { reasonCode: 'selection_missing' });
  }

  const selectedBinding = selectedBindings[input.capability];
  if (selectedBinding === null) {
    return createRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding: null,
      reasonCode: 'selection_cleared',
    });
  }

  if (!selectedBinding) {
    return createRuntimeRouteCapabilityProjection(input.capability, { reasonCode: 'binding_unresolved' });
  }

  if (!routeRuntime) {
    return createRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding,
      reasonCode: 'binding_unresolved',
    });
  }

  let resolvedBinding: RuntimeResolvedBinding;
  try {
    resolvedBinding = await routeRuntime.resolve({
      capability: input.capability,
      binding: selectedBinding,
    });
  } catch (error) {
    const mappedReasonCode = runtimeRouteCapabilityReasonCodeFromError(error);
    return createRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding,
      reasonCode: mappedReasonCode || 'binding_unresolved',
    });
  }
  if (!resolvedBinding?.resolvedBindingRef) {
    return createRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding,
      resolvedBinding,
      reasonCode: 'binding_unresolved',
    });
  }

  let health: RuntimeRouteHealthResult;
  try {
    health = await routeRuntime.checkHealth({
      capability: input.capability,
      binding: selectedBinding,
    });
  } catch (error) {
    const mappedReasonCode = runtimeRouteCapabilityReasonCodeFromError(error);
    return createRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding,
      resolvedBinding,
      reasonCode: mappedReasonCode || 'route_unhealthy',
    });
  }
  if (!isRuntimeRouteCapabilityHealthHealthy(health)) {
    return createRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding,
      resolvedBinding,
      health,
      reasonCode: isRuntimeRouteCapabilityHealthNotReady(health, resolvedBinding)
        ? 'route_not_ready'
        : 'route_unhealthy',
    });
  }

  const expectedMetadataCapability = toRuntimeRouteCanonicalCapability(input.capability);
  let metadata: RuntimeRouteDescribeResult;
  try {
    metadata = await routeRuntime.describe({
      capability: expectedMetadataCapability as RuntimeRouteAppCapability,
      resolvedBindingRef: resolvedBinding.resolvedBindingRef,
    });
  } catch (error) {
    const mappedReasonCode = runtimeRouteCapabilityReasonCodeFromError(error);
    return createRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding,
      resolvedBinding,
      health,
      reasonCode: mappedReasonCode === 'host_denied' ? 'host_denied' : 'metadata_missing',
    });
  }
  if (!metadata || metadata.capability !== expectedMetadataCapability || metadata.metadataKind !== expectedMetadataCapability) {
    return createRuntimeRouteCapabilityProjection(input.capability, {
      selectedBinding,
      resolvedBinding,
      health,
      reasonCode: 'metadata_missing',
    });
  }

  return createRuntimeRouteCapabilityProjection(input.capability, {
    selectedBinding,
    resolvedBinding,
    health,
    metadata,
    supported: true,
    reasonCode: null,
  });
}

export async function buildRuntimeRouteCapabilityProjectionMap(input: {
  selectionStore: RuntimeRouteCapabilitySelectionStore;
  routeRuntime?: RuntimeRouteCapabilityRuntime | null;
  hostAllowlist?: Partial<Record<RuntimeRouteAppCapability, boolean>>;
  capabilities?: readonly RuntimeRouteAppCapability[];
}): Promise<RuntimeRouteCapabilityProjectionMap> {
  const capabilities = input.capabilities || RUNTIME_ROUTE_APP_CAPABILITIES;
  const entries = await Promise.all(capabilities.map(async (capability) => {
    const projection = await buildRuntimeRouteCapabilityProjection({
      capability,
      selectionStore: input.selectionStore,
      routeRuntime: input.routeRuntime,
      hostAllowed: input.hostAllowlist?.[capability] !== false,
    });
    return [capability, projection] as const;
  }));
  return Object.fromEntries(entries) as RuntimeRouteCapabilityProjectionMap;
}
