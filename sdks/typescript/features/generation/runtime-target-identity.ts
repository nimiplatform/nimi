import type { RuntimeDurableTargetRef } from '../../core-generated/runtime-protobuf/runtime/v1/runtime_target_identity';
import { createNimiError, ReasonCode } from '../../types';

export interface NimiRuntimeDurableTargetIdentityInput {
  readonly targetRef?: RuntimeDurableTargetRef;
  readonly modelId?: string;
  readonly connectorId?: string;
  readonly context: string;
  readonly requireTargetRef?: boolean;
}

export interface NimiRuntimeDurableTargetIdentity {
  readonly targetRef?: RuntimeDurableTargetRef;
  readonly modelId: string;
  readonly connectorId: string;
}

export function resolveNimiRuntimeDurableTargetIdentity(
  input: NimiRuntimeDurableTargetIdentityInput,
): NimiRuntimeDurableTargetIdentity {
  const targetRef = input.targetRef;
  if (!targetRef) {
    if (input.requireTargetRef) {
      throw runtimeTargetIdentityError(
        'SDK_GENERATION_RUNTIME_TARGET_REF_REQUIRED',
        `${input.context} requires Runtime targetRef`,
        'select_runtime_target_ref',
      );
    }
    return {
      modelId: normalizeText(input.modelId),
      connectorId: normalizeText(input.connectorId),
    };
  }

  const cloudTarget = targetRef.target.oneofKind === 'cloud' ? targetRef.target.cloud : null;
  if (!cloudTarget) {
    return {
      targetRef,
      modelId: normalizeText(input.modelId),
      connectorId: normalizeText(input.connectorId),
    };
  }

  const providerModelId = normalizeText(cloudTarget.providerModelId);
  const connectorId = normalizeText(cloudTarget.connectorId);
  const requestedModelId = normalizeText(input.modelId);
  const requestedConnectorId = normalizeText(input.connectorId);
  if (!providerModelId || !connectorId) {
    throw runtimeTargetIdentityError(
      'SDK_GENERATION_RUNTIME_TARGET_REF_INVALID',
      `${input.context} cloud targetRef requires connectorId and providerModelId`,
      'resolve_complete_cloud_runtime_target_ref',
    );
  }
  if (requestedModelId && requestedModelId !== providerModelId) {
    throw runtimeTargetIdentityError(
      'SDK_GENERATION_RUNTIME_TARGET_REF_MISMATCH',
      `${input.context} cloud modelId must match targetRef.providerModelId`,
      'call_generation_with_resolved_cloud_provider_model_id',
    );
  }
  if (requestedConnectorId && requestedConnectorId !== connectorId) {
    throw runtimeTargetIdentityError(
      'SDK_GENERATION_RUNTIME_TARGET_REF_MISMATCH',
      `${input.context} cloud connectorId must match targetRef.connectorId`,
      'remove_stale_connector_id_or_resolve_runtime_target_ref',
    );
  }
  return {
    targetRef,
    modelId: providerModelId,
    connectorId,
  };
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function runtimeTargetIdentityError(code: string, message: string, actionHint: string): Error {
  return createNimiError({
    message,
    code,
    reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
    actionHint,
    source: 'sdk',
  });
}
