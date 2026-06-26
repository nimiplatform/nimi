import type { RuntimeDurableTargetRef } from '../../core-generated/runtime-protobuf/runtime/v1/runtime_target_identity';
import { ReasonCode, createNimiError } from '../../types';
import type { NimiAIConfigTargetRef } from './config-types';

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

export function toRuntimeDurableTargetRef(
  targetRef: NimiAIConfigTargetRef | null | undefined,
): RuntimeDurableTargetRef {
  if (!targetRef) {
    throw createNimiError({
      message: 'Runtime-backed Nimi AI requires a v2 runtime targetRef before scenario dispatch',
      code: ReasonCode.SDK_AI_INPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
      actionHint: 'resolve_runtime_target_ref_before_invocation',
      source: 'sdk',
    });
  }
  if (targetRef.kind === 'local-runtime') {
    if (targetRef.version !== 'v2') {
      throw createNimiError({
        message: 'Runtime-backed local targetRef must use version v2',
        code: ReasonCode.SDK_AI_INPUT_INVALID,
        reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
        actionHint: 'provide_v2_runtime_target_ref',
        source: 'sdk',
      });
    }
    const profileBindingId = normalizeText(targetRef.profileBindingId);
    const readinessRef = normalizeText(targetRef.readinessRef);
    if (profileBindingId && readinessRef) {
      throw createNimiError({
        message: 'Runtime-backed local targetRef must not contain both profileBindingId and readinessRef',
        code: ReasonCode.SDK_AI_INPUT_INVALID,
        reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
        actionHint: 'provide_exactly_one_local_runtime_target_ref',
        source: 'sdk',
      });
    }
    if (profileBindingId) {
      return {
        target: {
          oneofKind: 'localRuntime',
          localRuntime: {
            version: 'v2',
            ref: { oneofKind: 'profileBindingId', profileBindingId },
          },
        },
      };
    }
    if (readinessRef) {
      return {
        target: {
          oneofKind: 'localRuntime',
          localRuntime: {
            version: 'v2',
            ref: { oneofKind: 'readinessRef', readinessRef },
          },
        },
      };
    }
    throw createNimiError({
      message: 'Runtime-backed local targetRef requires profileBindingId or readinessRef',
      code: ReasonCode.SDK_AI_INPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
      actionHint: 'provide_local_runtime_target_ref',
      source: 'sdk',
    });
  }
  if (targetRef.kind === 'cloud-connector') {
    const connectorId = normalizeText(targetRef.connectorId);
    const remoteModelCatalogId = normalizeText(targetRef.remoteModelCatalogId);
    const providerModelId = normalizeText(targetRef.providerModelId);
    if (!connectorId || !remoteModelCatalogId || !providerModelId) {
      throw createNimiError({
        message: 'Runtime-backed cloud targetRef requires connectorId, remoteModelCatalogId, and providerModelId',
        code: ReasonCode.SDK_AI_INPUT_INVALID,
        reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
        actionHint: 'provide_cloud_runtime_target_ref',
        source: 'sdk',
      });
    }
    return {
      target: {
        oneofKind: 'cloud',
        cloud: {
          version: 'v2',
          connectorId,
          remoteModelCatalogId,
          providerModelId,
          provider: normalizeText(targetRef.provider),
        },
      },
    };
  }
  throw createNimiError({
    message: 'Runtime-backed Nimi AI requires a live runtime targetRef, not a profile-slice ref',
    code: ReasonCode.SDK_AI_INPUT_INVALID,
    reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
    actionHint: 'materialize_profile_slice_before_invocation',
    source: 'sdk',
  });
}
