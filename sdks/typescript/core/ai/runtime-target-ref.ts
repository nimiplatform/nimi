import type { RuntimeDurableTargetRef } from '../../core-generated/runtime-protobuf/runtime/v1/runtime_target_identity';
import { ReasonCode, createNimiError } from '../../types';
import type { NimiModelRef } from '../contracts';
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

export interface NimiRuntimeScenarioTargetIdentityInput {
  readonly targetRef: NimiAIConfigTargetRef | null | undefined;
  readonly model: NimiModelRef;
  readonly connectorId?: string;
}

export interface NimiRuntimeScenarioTargetIdentity {
  readonly targetRef: RuntimeDurableTargetRef;
  readonly modelId: string;
  readonly connectorId: string;
}

export function toRuntimeScenarioTargetIdentity(
  input: NimiRuntimeScenarioTargetIdentityInput,
): NimiRuntimeScenarioTargetIdentity {
  const durableTargetRef = toRuntimeDurableTargetRef(input.targetRef);
  const modelId = normalizeText(input.model.modelId);

  if (input.targetRef?.kind === 'cloud-connector') {
    const connectorId = normalizeText(input.targetRef.connectorId);
    const providerModelId = normalizeText(input.targetRef.providerModelId);
    const explicitConnectorId = normalizeText(input.connectorId);
    if (modelId !== providerModelId) {
      throw createNimiError({
        message: 'Runtime-backed cloud model.modelId must match targetRef.providerModelId',
        code: ReasonCode.SDK_AI_INPUT_INVALID,
        reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
        actionHint: 'call_runtime_ai_with_resolved_cloud_provider_model_id',
        source: 'sdk',
        details: { modelId, providerModelId },
      });
    }
    if (explicitConnectorId && explicitConnectorId !== connectorId) {
      throw createNimiError({
        message: 'Runtime-backed cloud connectorId must match targetRef.connectorId',
        code: ReasonCode.SDK_AI_INPUT_INVALID,
        reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
        actionHint: 'remove_stale_connector_id_or_resolve_runtime_target_ref',
        source: 'sdk',
        details: { connectorId: explicitConnectorId, targetConnectorId: connectorId },
      });
    }
    return {
      targetRef: durableTargetRef,
      modelId: providerModelId,
      connectorId,
    };
  }

  return {
    targetRef: durableTargetRef,
    modelId,
    connectorId: normalizeText(input.connectorId ?? input.model.providerId),
  };
}
