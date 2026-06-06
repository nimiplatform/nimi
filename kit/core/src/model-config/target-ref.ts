// Pure-logic compact target-ref helpers for Kit model-config.
//
// Kit consumes SDK NimiAIConfig compact refs and requirement declarations only. It
// does not serialize NimiRuntimeRouteBinding, selected bindings, provider health,
// route availability, local paths, or materialization evidence.

import type { NimiAIConfig } from '@nimiplatform/kit/core/sdk-contract';
import type {
  NimiAICapabilityRequirementDeclaration,
  NimiAICapabilityRequirementSlice,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  ModelConfigBindingSummary,
  ModelConfigCapabilityPatch,
  ModelConfigTargetRef,
} from './types.js';
import type {
  CanonicalCapabilityDescriptor,
} from '@nimiplatform/kit/core/runtime-capabilities';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sortedRequirementSlices(
  declaration: NimiAICapabilityRequirementDeclaration,
): NimiAICapabilityRequirementSlice[] {
  const seen = new Set<string>();
  const slices: NimiAICapabilityRequirementSlice[] = [];
  for (const slice of [
    ...declaration.requiredSlices,
    ...(declaration.optionalSlices || []),
  ]) {
    if (seen.has(slice.capability)) {
      continue;
    }
    seen.add(slice.capability);
    slices.push(slice);
  }
  return slices;
}

export function selectRequirementDescriptors(
  declaration: NimiAICapabilityRequirementDeclaration,
  catalogById: Readonly<Record<string, CanonicalCapabilityDescriptor>>,
): ReadonlyArray<CanonicalCapabilityDescriptor> {
  const out: CanonicalCapabilityDescriptor[] = [];
  for (const slice of sortedRequirementSlices(declaration)) {
    const descriptor = catalogById[slice.capability];
    if (descriptor) {
      out.push(descriptor);
    }
  }
  return out;
}

export function readModelConfigTargetRef(
  config: NimiAIConfig,
  capabilityId: string,
): ModelConfigTargetRef | null {
  return config.capabilities.targetRefs?.[capabilityId] ?? null;
}

export function hasModelConfigTargetRef(
  config: NimiAIConfig,
  capabilityId: string,
): boolean {
  return readModelConfigTargetRef(config, capabilityId) !== null;
}

export function summarizeTargetRef(
  targetRef: ModelConfigTargetRef | null | undefined,
): ModelConfigBindingSummary {
  if (!targetRef) {
    return { label: 'Setup required', detail: null };
  }
  if (targetRef.kind === 'local-runtime') {
    const detail = [
      normalizeText(targetRef.readinessRef),
      normalizeText(targetRef.profileId),
      normalizeText(targetRef.targetId),
    ].filter(Boolean).join(' · ');
    return { label: 'Local runtime target', detail: detail || null };
  }
  if (targetRef.kind === 'cloud-connector') {
    return {
      label: normalizeText(targetRef.provider) || normalizeText(targetRef.connectorId) || 'Cloud connector',
      detail: normalizeText(targetRef.providerModelId) || null,
    };
  }
  return {
    label: 'Profile slice',
    detail: [
      normalizeText(targetRef.sourceProfileId),
      normalizeText(targetRef.sliceId),
    ].filter(Boolean).join(' · ') || null,
  };
}

export function applyModelConfigCapabilityPatch(
  config: NimiAIConfig,
  capabilityId: string,
  patch: ModelConfigCapabilityPatch,
): NimiAIConfig {
  const nextTargetRefs = { ...config.capabilities.targetRefs };
  const nextParams = { ...config.capabilities.selectedParams };

  if (Object.prototype.hasOwnProperty.call(patch, 'targetRef')) {
    if (patch.targetRef) {
      nextTargetRefs[capabilityId] = patch.targetRef;
    } else {
      delete nextTargetRefs[capabilityId];
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'params')) {
    if (patch.params === undefined) {
      delete nextParams[capabilityId];
    } else {
      nextParams[capabilityId] = patch.params;
    }
  }

  return {
    ...config,
    capabilities: {
      targetRefs: nextTargetRefs,
      selectedParams: nextParams,
    },
  };
}
