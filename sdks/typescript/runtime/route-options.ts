import { createNimiError } from '../types';

export type NimiRuntimeRouteSource = 'local-runtime' | 'cloud-connector';
export type NimiRuntimeCanonicalCapability = string;
export type NimiRuntimeRouteModelProfileContextSource =
  | 'provider-api'
  | 'model-card'
  | 'runtime-metadata'
  | string;

export type NimiRuntimeRouteTargetRef =
  | NimiRuntimeRouteLocalTargetRef
  | NimiRuntimeRouteCloudTargetRef;

export type NimiRuntimeRouteLocalTargetRef =
  | {
    readonly kind: 'local-runtime';
    readonly version: 'v2';
    readonly profileBindingId: string;
    readonly readinessRef?: never;
  }
  | {
    readonly kind: 'local-runtime';
    readonly version: 'v2';
    readonly readinessRef: string;
    readonly profileBindingId?: never;
  };

export interface NimiRuntimeRouteCloudTargetRef {
  readonly kind: 'cloud-connector';
  readonly version: 'v2';
  readonly connectorId: string;
  readonly remoteModelCatalogId: string;
  readonly providerModelId: string;
  readonly provider?: string;
}

export interface NimiRuntimeTargetInventoryDisplay {
  readonly label: string;
  readonly connectorLabel?: string;
  readonly connectorProviderLabel?: string;
  readonly modelLabel?: string;
  readonly provider?: string;
  readonly engine?: string;
  readonly model?: string;
}

export interface NimiRuntimeTargetInventoryReadiness {
  readonly status: 'ready' | 'installed' | 'unhealthy' | 'removed' | 'unknown' | string;
  readonly reasonCode?: string;
  readonly actionHint?: string;
  readonly endpoint?: string;
}

export interface NimiRuntimeTargetInventoryCompatibility {
  readonly capabilities: readonly string[];
}

export type NimiRuntimeTargetInventoryEvidence =
  | {
    readonly source: 'local-runtime';
    readonly localAssetId: string;
    readonly resolvedModelId: string;
    readonly engine?: string;
    readonly endpoint?: string;
    readonly runtimeStatus?: string;
    readonly updatedAt?: string;
  }
  | {
    readonly source: 'cloud-connector';
    readonly connectorId: string;
    readonly remoteModelCatalogId: string;
    readonly providerModelId: string;
    readonly provider?: string;
    readonly endpoint?: string;
    readonly endpointProfileId?: string;
    readonly connectorSnapshotId?: string;
    readonly inventorySnapshotId?: string;
  };

export interface NimiRuntimeTargetInventoryItem {
  readonly targetRef: NimiRuntimeRouteTargetRef;
  readonly display: NimiRuntimeTargetInventoryDisplay;
  readonly readiness: NimiRuntimeTargetInventoryReadiness;
  readonly compatibility: NimiRuntimeTargetInventoryCompatibility;
  readonly evidence: NimiRuntimeTargetInventoryEvidence;
}

export interface RuntimeTargetInventoryProjection {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly targets: readonly NimiRuntimeTargetInventoryItem[];
}

export interface NimiRuntimeRouteConnectorOption {
  readonly id: string;
  readonly label: string;
  readonly vendor?: string;
  readonly provider?: string;
  readonly targets: readonly NimiRuntimeTargetInventoryItem[];
  readonly modelProfiles?: readonly NimiRuntimeRouteModelProfile[];
}

export interface NimiRuntimeRouteModelProfile {
  readonly providerModelId: string;
  readonly maxContextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly contextSource?: NimiRuntimeRouteModelProfileContextSource;
}

export interface NimiRuntimeRouteOptionsSnapshot {
  readonly capability?: NimiRuntimeCanonicalCapability;
  readonly snapshotRevision?: string;
  readonly selectedTargetRef: NimiRuntimeRouteTargetRef | null;
  readonly inventory: RuntimeTargetInventoryProjection;
}

export interface NimiListRuntimeRouteOptionsInput {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly targetId?: string;
  readonly selectedTargetRef?: NimiRuntimeRouteTargetRef | null;
}

export interface NimiRuntimeRouteOptionsClient {
  listRuntimeRouteOptions(
    input: NimiListRuntimeRouteOptionsInput,
  ): Promise<NimiRuntimeRouteOptionsSnapshot> | NimiRuntimeRouteOptionsSnapshot;
}

export function normalizeNimiRuntimeRouteCapabilityToken(value: unknown): NimiRuntimeCanonicalCapability | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

export function runtimeNimiRouteCapabilitiesMatch(
  capabilities: readonly string[] | undefined,
  capability: unknown,
): boolean {
  const required = normalizeNimiRuntimeRouteCapabilityToken(capability);
  if (!required) {
    return false;
  }
  return (capabilities || []).some((item) => normalizeNimiRuntimeRouteCapabilityToken(item) === required);
}

export async function listNimiRuntimeRouteOptions(
  client: NimiRuntimeRouteOptionsClient,
  input: NimiListRuntimeRouteOptionsInput,
): Promise<NimiRuntimeRouteOptionsSnapshot> {
  const capability = normalizeNimiRuntimeRouteCapabilityToken(input.capability);
  if (!capability) {
    throw createNimiError({
      message: 'Runtime route capability is required.',
      reasonCode: 'SDK_RUNTIME_ROUTE_INPUT_INVALID',
      actionHint: 'provide_runtime_route_capability',
      source: 'sdk',
    });
  }
  if (!client || typeof client.listRuntimeRouteOptions !== 'function') {
    throw createNimiError({
      message: 'Runtime route options require an explicit route options client.',
      reasonCode: 'SDK_RUNTIME_ROUTE_CLIENT_REQUIRED',
      actionHint: 'provide_runtime_route_options_client',
      source: 'sdk',
    });
  }
  assertNoLegacyRouteSelection(input);
  const snapshot = await client.listRuntimeRouteOptions({
    ...input,
    capability,
    selectedTargetRef: input.selectedTargetRef ? normalizeNimiRuntimeRouteTargetRef(input.selectedTargetRef) : input.selectedTargetRef,
  });
  return normalizeNimiRuntimeRouteOptionsSnapshot(snapshot, capability);
}

function normalizeNimiRuntimeRouteText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function assertNoLegacyRouteSelection(input: object): void {
  const record = input as Record<string, unknown>;
  if ('selectedBinding' in record) {
    throw createNimiError({
      message: 'Runtime route listOptions no longer accepts selectedBinding; use selectedTargetRef.',
      reasonCode: 'SDK_RUNTIME_ROUTE_INPUT_INVALID',
      actionHint: 'provide_runtime_route_target_ref',
      source: 'sdk',
    });
  }
}

function failInvalidTargetRef(message: string): never {
  throw createNimiError({
    message,
    reasonCode: 'SDK_RUNTIME_ROUTE_INPUT_INVALID',
    actionHint: 'provide_runtime_route_target_ref',
    source: 'sdk',
  });
}

export function normalizeNimiRuntimeRouteTargetRef(value: unknown): NimiRuntimeRouteTargetRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failInvalidTargetRef('Runtime route targetRef must be an object.');
  }
  const record = value as Record<string, unknown>;
  if ('source' in record || 'model' in record || 'modelId' in record || 'localModelId' in record || 'goRuntimeLocalModelId' in record) {
    failInvalidTargetRef('Runtime route targetRef must not contain legacy route binding evidence.');
  }
  const kind = normalizeNimiRuntimeRouteText(record.kind);
  if (kind === 'local-runtime') {
    if (record.version !== 'v2') {
      failInvalidTargetRef('Runtime local targetRef version must be v2.');
    }
    const profileBindingId = normalizeNimiRuntimeRouteText(record.profileBindingId);
    const readinessRef = normalizeNimiRuntimeRouteText(record.readinessRef);
    if (Boolean(profileBindingId) === Boolean(readinessRef)) {
      failInvalidTargetRef('Runtime local targetRef requires exactly one of profileBindingId or readinessRef.');
    }
    return profileBindingId
      ? { kind: 'local-runtime', version: 'v2', profileBindingId }
      : { kind: 'local-runtime', version: 'v2', readinessRef };
  }
  if (kind === 'cloud-connector') {
    const connectorId = normalizeNimiRuntimeRouteText(record.connectorId);
    const remoteModelCatalogId = normalizeNimiRuntimeRouteText(record.remoteModelCatalogId);
    const providerModelId = normalizeNimiRuntimeRouteText(record.providerModelId);
    const provider = normalizeNimiRuntimeRouteText(record.provider);
    if (!connectorId || !remoteModelCatalogId || !providerModelId) {
      failInvalidTargetRef('Runtime cloud targetRef requires connectorId, remoteModelCatalogId, and providerModelId.');
    }
    return {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId,
      remoteModelCatalogId,
      providerModelId,
      ...(provider ? { provider } : {}),
    };
  }
  failInvalidTargetRef(`Runtime route targetRef kind "${kind}" is not supported.`);
}

export function nimiRuntimeRouteTargetRefKey(targetRef: NimiRuntimeRouteTargetRef | null | undefined): string {
  if (!targetRef) return '';
  if (targetRef.kind === 'local-runtime') {
    return [
      'local-runtime',
      targetRef.version,
      normalizeNimiRuntimeRouteText(targetRef.profileBindingId),
      normalizeNimiRuntimeRouteText(targetRef.readinessRef),
    ].join('|');
  }
  return [
    'cloud-connector',
    targetRef.version,
    normalizeNimiRuntimeRouteText(targetRef.connectorId),
    normalizeNimiRuntimeRouteText(targetRef.remoteModelCatalogId),
    normalizeNimiRuntimeRouteText(targetRef.providerModelId),
  ].join('|');
}

export function nimiRuntimeRouteTargetRefsMatch(
  left: NimiRuntimeRouteTargetRef | null | undefined,
  right: NimiRuntimeRouteTargetRef | null | undefined,
): boolean {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === 'cloud-connector' && right.kind === 'cloud-connector') {
    return normalizeNimiRuntimeRouteText(left.connectorId) === normalizeNimiRuntimeRouteText(right.connectorId)
      && normalizeNimiRuntimeRouteText(left.remoteModelCatalogId) === normalizeNimiRuntimeRouteText(right.remoteModelCatalogId);
  }
  return nimiRuntimeRouteTargetRefKey(left) === nimiRuntimeRouteTargetRefKey(right);
}

export function isNimiRuntimeTargetInventoryItemSelectable(item: NimiRuntimeTargetInventoryItem): boolean {
  return Boolean(nimiRuntimeRouteTargetRefKey(item.targetRef))
    && normalizeNimiRuntimeRouteText(item.readiness.status).toLowerCase() !== 'removed';
}

export function findNimiRuntimeTargetInventoryItem(
  projection: RuntimeTargetInventoryProjection | null | undefined,
  targetRef: NimiRuntimeRouteTargetRef | null | undefined,
): NimiRuntimeTargetInventoryItem | null {
  if (!projection || !targetRef) return null;
  const normalized = normalizeNimiRuntimeRouteTargetRef(targetRef);
  return projection.targets.find((item) => nimiRuntimeRouteTargetRefsMatch(item.targetRef, normalized)) || null;
}

function normalizeInventoryItem(item: NimiRuntimeTargetInventoryItem): NimiRuntimeTargetInventoryItem {
  return {
    ...item,
    targetRef: normalizeNimiRuntimeRouteTargetRef(item.targetRef),
    display: {
      label: normalizeNimiRuntimeRouteText(item.display.label),
      connectorLabel: normalizeNimiRuntimeRouteText(item.display.connectorLabel) || undefined,
      connectorProviderLabel: normalizeNimiRuntimeRouteText(item.display.connectorProviderLabel) || undefined,
      modelLabel: normalizeNimiRuntimeRouteText(item.display.modelLabel) || undefined,
      provider: normalizeNimiRuntimeRouteText(item.display.provider) || undefined,
      engine: normalizeNimiRuntimeRouteText(item.display.engine) || undefined,
      model: normalizeNimiRuntimeRouteText(item.display.model) || undefined,
    },
    readiness: {
      status: normalizeNimiRuntimeRouteText(item.readiness.status) || 'unknown',
      reasonCode: normalizeNimiRuntimeRouteText(item.readiness.reasonCode) || undefined,
      actionHint: normalizeNimiRuntimeRouteText(item.readiness.actionHint) || undefined,
      endpoint: normalizeNimiRuntimeRouteText(item.readiness.endpoint) || undefined,
    },
    compatibility: {
      capabilities: [...new Set((item.compatibility.capabilities || [])
        .map((capability) => normalizeNimiRuntimeRouteCapabilityToken(capability))
        .filter((capability): capability is string => Boolean(capability)))],
    },
    evidence: item.evidence,
  };
}

export function normalizeNimiRuntimeRouteOptionsSnapshot(
  snapshot: NimiRuntimeRouteOptionsSnapshot,
  fallbackCapability?: NimiRuntimeCanonicalCapability,
): NimiRuntimeRouteOptionsSnapshot {
  const capability = normalizeNimiRuntimeRouteCapabilityToken(snapshot.capability || snapshot.inventory?.capability || fallbackCapability);
  if (!capability) {
    throw createNimiError({
      message: 'Runtime route options snapshot capability is required.',
      reasonCode: 'SDK_RUNTIME_ROUTE_INPUT_INVALID',
      actionHint: 'provide_runtime_route_capability',
      source: 'sdk',
    });
  }
  const targets = (snapshot.inventory?.targets || []).map(normalizeInventoryItem);
  const selectedTargetRef = snapshot.selectedTargetRef
    ? normalizeNimiRuntimeRouteTargetRef(snapshot.selectedTargetRef)
    : null;
  return {
    capability,
    snapshotRevision: normalizeNimiRuntimeRouteText(snapshot.snapshotRevision) || undefined,
    selectedTargetRef,
    inventory: {
      capability,
      targets,
    },
  };
}

export function findNimiRuntimeRouteModelProfile(
  snapshot: NimiRuntimeRouteOptionsSnapshot | null | undefined,
  targetRef: NimiRuntimeRouteTargetRef | null | undefined,
): NimiRuntimeRouteModelProfile | null {
  if (!snapshot || !targetRef || targetRef.kind !== 'cloud-connector') {
    return null;
  }
  const item = findNimiRuntimeTargetInventoryItem(snapshot.inventory, targetRef);
  if (!item || item.targetRef.kind !== 'cloud-connector') {
    return null;
  }
  return {
    providerModelId: item.targetRef.providerModelId,
  };
}
