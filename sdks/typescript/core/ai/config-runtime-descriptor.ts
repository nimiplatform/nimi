import type {
  NimiAICapabilityRequirementDeclaration,
  NimiAICapabilityRequirementSlice,
  NimiAIProfile,
  NimiAIProfileCapabilityIntent,
  NimiRuntimeProfileDescriptor,
  NimiRuntimeProfileDescriptorCapabilitySlice,
  NimiRuntimeProfileDescriptorSliceInput,
} from './config-types';
import { assertNimiAIScopeRef } from './config-scope';
import { validateNimiAIProfile } from './config-profile';
import { aiConfigError, requireNonEmptyText } from './config-internal';

export function formNimiRuntimeProfileDescriptor(input: {
  readonly profile: NimiAIProfile;
  readonly requirementDeclarations: readonly NimiAICapabilityRequirementDeclaration[];
  readonly descriptorId: string;
  readonly sourceProfileDigest: string;
  readonly projectedAt?: string;
}): NimiRuntimeProfileDescriptor {
  const validation = validateNimiAIProfile(input.profile);
  if (!validation.valid) {
    throw aiConfigError('SDK_AI_PROFILE_INVALID', `AI profile is invalid: ${validation.errors.join('; ')}`, 'fix_ai_profile_contract');
  }
  const descriptorId = requireNonEmptyText(input.descriptorId, 'runtime descriptorId is required', 'provide_runtime_descriptor_id');
  const sourceProfileDigest = requireNonEmptyText(
    input.sourceProfileDigest,
    'runtime descriptor sourceProfileDigest is required',
    'provide_source_profile_digest',
  );
  if (input.requirementDeclarations.length === 0) {
    throw aiConfigError('SDK_AI_RUNTIME_DESCRIPTOR_INVALID', 'runtime descriptor requires at least one requirement declaration', 'provide_requirement_declaration');
  }
  const requirementRefs: string[] = [];
  const capabilitySlices: NimiRuntimeProfileDescriptorCapabilitySlice[] = [];
  for (const declaration of input.requirementDeclarations) {
    validateRequirementDeclaration(declaration);
    requirementRefs.push(declaration.requirementId);
    const slices = [
      ...declaration.requiredSlices,
      ...(declaration.optionalSlices ?? []),
    ];
    for (const slice of slices) {
      const intent = input.profile.capabilities[slice.capability] ?? null;
      const authored = intent?.runtimeDescriptor ?? slice.runtimeDescriptor;
      if (!authored) {
        if (slice.readinessPolicy === 'required') {
          throw aiConfigError(
            'SDK_AI_RUNTIME_DESCRIPTOR_INVALID',
            `runtime descriptor slice ${slice.requirementSliceId} requires authored runtimeDescriptor`,
            'provide_runtime_descriptor_slice',
          );
        }
        continue;
      }
      capabilitySlices.push(formRuntimeDescriptorSlice(slice, intent, authored));
    }
  }
  if (capabilitySlices.length === 0) {
    throw aiConfigError('SDK_AI_RUNTIME_DESCRIPTOR_INVALID', 'runtime descriptor produced no capability slices', 'provide_runtime_descriptor_slices');
  }
  return {
    schemaVersion: 1,
    descriptorId,
    profileRef: {
      profileId: input.profile.profileId,
      title: input.profile.title,
    },
    sourceProfileDigest,
    projectionOrigin: {
      component: 'sdks.typescript.ai.formRuntimeDescriptor',
      projectedAt: input.projectedAt ?? new Date().toISOString(),
    },
    requirementRefs,
    capabilitySlices,
  };
}

function validateRequirementDeclaration(declaration: NimiAICapabilityRequirementDeclaration): void {
  requireNonEmptyText(declaration.requirementId, 'requirementId is required', 'provide_ai_requirement_id');
  assertNimiAIScopeRef(declaration.scopeRef);
  requireNonEmptyText(declaration.setupProjectionPolicy, 'setupProjectionPolicy is required', 'provide_setup_projection_policy');
  if (!Array.isArray(declaration.requiredSlices)) {
    throw aiConfigError('SDK_AI_REQUIREMENT_INVALID', 'requiredSlices must be an array', 'provide_required_ai_slices');
  }
}

function formRuntimeDescriptorSlice(
  slice: NimiAICapabilityRequirementSlice,
  intent: NimiAIProfileCapabilityIntent | null,
  authored: NimiRuntimeProfileDescriptorSliceInput,
): NimiRuntimeProfileDescriptorCapabilitySlice {
  const executionMode = authored.executionMode
    ?? (intent?.targetRef?.kind === 'cloud-connector' ? 'cloud_connector' : 'local');
  const base = {
    sliceId: authored.sliceId ?? slice.profileSliceRef,
    capability: slice.capability,
    executionMode,
    contractState: authored.contractState ?? intent?.contractState ?? 'declared',
    readinessPolicy: slice.readinessPolicy,
    paramsRef: authored.paramsRef ?? (intent?.params === undefined ? 'params:none' : `params:${slice.capability}`),
    ...(authored.paramsDigest ? { paramsDigest: authored.paramsDigest } : {}),
    ...(authored.environmentDigest ? { environmentDigest: authored.environmentDigest } : {}),
  } satisfies Partial<NimiRuntimeProfileDescriptorCapabilitySlice> & {
    readonly executionMode: 'local' | 'cloud_connector';
  };

  if (executionMode === 'local') {
    if (!authored.execution?.backend || !authored.model?.family) {
      throw aiConfigError(
        'SDK_AI_RUNTIME_DESCRIPTOR_INVALID',
        `runtime descriptor slice ${slice.requirementSliceId} requires execution.backend and model.family`,
        'provide_local_runtime_descriptor_fields',
      );
    }
    return {
      ...base,
      execution: authored.execution,
      model: authored.model,
    } as NimiRuntimeProfileDescriptorCapabilitySlice;
  }

  const targetRef = intent?.targetRef?.kind === 'cloud-connector' ? intent.targetRef : null;
  const provider = authored.provider ?? targetRef?.provider;
  const modelId = authored.modelId ?? targetRef?.providerModelId;
  const connectorSelector = authored.connectorSelector ?? targetRef?.connectorId;
  if (!provider || !authored.providerCapability || !modelId || !authored.credentialPolicy) {
    throw aiConfigError(
      'SDK_AI_RUNTIME_DESCRIPTOR_INVALID',
      `runtime descriptor slice ${slice.requirementSliceId} requires cloud provider/model/credential fields`,
      'provide_cloud_runtime_descriptor_fields',
    );
  }
  return {
    ...base,
    provider,
    providerCapability: authored.providerCapability,
    modelId,
    credentialPolicy: authored.credentialPolicy,
    ...(connectorSelector ? { connectorSelector } : {}),
  } as NimiRuntimeProfileDescriptorCapabilitySlice;
}
