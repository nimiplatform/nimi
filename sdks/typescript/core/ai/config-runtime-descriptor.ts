import type {
  NimiAICapabilityRequirementDeclaration,
  NimiAICapabilityRequirementSlice,
  NimiAIRuntimeActivationConsumerRef,
  NimiAIProfile,
  NimiAIProfileCapabilityIntent,
  NimiRuntimeProfileDescriptor,
  NimiRuntimeProfileDescriptorAssetBinding,
  NimiRuntimeProfileDescriptorAssetBindingWire,
  NimiRuntimeProfileDescriptorCapabilitySlice,
  NimiRuntimeProfileDescriptorCapabilitySliceWire,
  NimiRuntimeProfileDescriptorCompanionOccurrence,
  NimiRuntimeProfileDescriptorCompanionOccurrenceWire,
  NimiRuntimeProfileDescriptorExecution,
  NimiRuntimeProfileDescriptorExecutionWire,
  NimiRuntimeProfileDescriptorHuggingFaceSourceWire,
  NimiRuntimeProfileDescriptorManualSourceWire,
  NimiRuntimeProfileDescriptorSliceInput,
  NimiRuntimeProfileDescriptorWire,
} from './config-types';
import { assertNimiAIScopeRef } from './config-scope';
import { validateNimiAIProfile } from './config-profile';
import { aiConfigError, collectForbiddenPayloadErrors, requireNonEmptyText } from './config-internal';

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
    const activationConsumers = resolveRuntimeActivationConsumers(declaration, slices);
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
      capabilitySlices.push(formRuntimeDescriptorSlice(
        slice,
        intent,
        authored,
        activationConsumers.get(slice.requirementSliceId) ?? null,
      ));
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
      ...(input.profile.version ? { version: input.profile.version } : {}),
      ...(input.profile.revision ? { revision: input.profile.revision } : {}),
    },
    sourceProfileDigest,
    projectionOrigin: {
      component: 'sdks.typescript.ai.formRuntimeDescriptor',
      projectedAt: input.projectedAt ?? new Date().toISOString(),
    },
    requirementRefs,
    capabilitySlices,
    ...(input.profile.assetBindings ? { assetBindings: input.profile.assetBindings } : {}),
    ...(input.profile.defaultParams ? { defaultParams: input.profile.defaultParams } : {}),
    ...(input.profile.editableFields ? { editableFields: input.profile.editableFields } : {}),
    ...(input.profile.prepareRequirements ? { prepareRequirements: input.profile.prepareRequirements } : {}),
    ...(input.profile.contractStates ? { contractStates: input.profile.contractStates } : {}),
    ...(input.profile.projectionWarnings ? { projectionWarnings: input.profile.projectionWarnings } : {}),
  };
}

function validateRequirementDeclaration(declaration: NimiAICapabilityRequirementDeclaration): void {
  const errors = collectForbiddenPayloadErrors(declaration, 'requirementDeclaration');
  requireNonEmptyText(declaration.requirementId, 'requirementId is required', 'provide_ai_requirement_id');
  assertNimiAIScopeRef(declaration.scopeRef);
  requireNonEmptyText(declaration.setupProjectionPolicy, 'setupProjectionPolicy is required', 'provide_setup_projection_policy');
  if (!Array.isArray(declaration.requiredSlices)) {
    throw aiConfigError('SDK_AI_REQUIREMENT_INVALID', 'requiredSlices must be an array', 'provide_required_ai_slices');
  }
  if (declaration.optionalSlices !== undefined && !Array.isArray(declaration.optionalSlices)) {
    errors.push('optionalSlices must be an array when provided');
  }
  for (const [index, slice] of declaration.requiredSlices.entries()) {
    errors.push(...validateRequirementSlice(slice, `requiredSlices[${index}]`));
  }
  if (Array.isArray(declaration.optionalSlices)) {
    for (const [index, slice] of declaration.optionalSlices.entries()) {
      errors.push(...validateRequirementSlice(slice, `optionalSlices[${index}]`));
    }
  }
  validateOptionalTextArray(declaration.editableFields, 'editableFields', errors);
  validateOptionalTextArray(declaration.readinessProjectionRefs, 'readinessProjectionRefs', errors);
  if (declaration.runtimeActivationConsumers !== undefined && !Array.isArray(declaration.runtimeActivationConsumers)) {
    errors.push('runtimeActivationConsumers must be an array when provided');
  }
  if (Array.isArray(declaration.runtimeActivationConsumers)) {
    for (const [index, consumer] of declaration.runtimeActivationConsumers.entries()) {
      if (!isRuntimeActivationConsumer(consumer)) {
        errors.push(`runtimeActivationConsumers[${index}] must include consumerId`);
      }
    }
  }
  if (errors.length > 0) {
    throw aiConfigError(
      'SDK_AI_REQUIREMENT_INVALID',
      `AI capability requirement declaration is invalid: ${errors.join('; ')}`,
      'fix_ai_requirement_declaration',
    );
  }
}

function formRuntimeDescriptorSlice(
  slice: NimiAICapabilityRequirementSlice,
  intent: NimiAIProfileCapabilityIntent | null,
  authored: NimiRuntimeProfileDescriptorSliceInput,
  activationConsumer: NimiAIRuntimeActivationConsumerRef | null,
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
    ...(authored.runtimeConsumerId ? { runtimeConsumerId: authored.runtimeConsumerId } : {}),
    ...(authored.consumerId ?? activationConsumer?.consumerId
      ? { consumerId: authored.consumerId ?? activationConsumer?.consumerId }
      : {}),
    ...(authored.consumerScope ?? activationConsumer?.consumerScope
      ? { consumerScope: authored.consumerScope ?? activationConsumer?.consumerScope }
      : {}),
    ...(authored.paramsSchemaRef ? { paramsSchemaRef: authored.paramsSchemaRef } : {}),
    ...(authored.assetRefs ? { assetRefs: authored.assetRefs } : {}),
    ...(authored.orderedCompanionOccurrences ? { orderedCompanionOccurrences: authored.orderedCompanionOccurrences } : {}),
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

export function toNimiRuntimeProfileDescriptorWire(
  descriptor: NimiRuntimeProfileDescriptor,
): NimiRuntimeProfileDescriptorWire {
  assertDescriptorPortable(descriptor);
  if (descriptor.schemaVersion !== 1) {
    throw aiConfigError(
      'SDK_AI_RUNTIME_DESCRIPTOR_INVALID',
      'runtime descriptor schemaVersion must be 1',
      'use_supported_runtime_descriptor_schema',
    );
  }
  assertNonEmptyArray(descriptor.requirementRefs, 'runtime descriptor requirementRefs', 'provide_requirement_ref');
  assertNonEmptyArray(descriptor.capabilitySlices, 'runtime descriptor capabilitySlices', 'provide_runtime_descriptor_slices');
  return dropUndefined({
    schema_version: descriptor.schemaVersion,
    descriptor_id: requireNonEmptyText(descriptor.descriptorId, 'runtime descriptorId is required', 'provide_runtime_descriptor_id'),
    profile_ref: dropUndefined({
      profile_id: requireNonEmptyText(descriptor.profileRef.profileId, 'runtime descriptor profileRef.profileId is required', 'provide_runtime_descriptor_profile_ref'),
      version: descriptor.profileRef.version,
      revision: descriptor.profileRef.revision,
    }),
    source_profile_digest: requireNonEmptyText(
      descriptor.sourceProfileDigest,
      'runtime descriptor sourceProfileDigest is required',
      'provide_source_profile_digest',
    ),
    projection_origin: {
      component: descriptor.projectionOrigin.component,
      projected_at: requireNonEmptyText(
        descriptor.projectionOrigin.projectedAt,
        'runtime descriptor projectedAt is required',
        'provide_runtime_descriptor_projection_time',
      ),
    },
    requirement_refs: descriptor.requirementRefs.map((ref) => requireNonEmptyText(ref, 'runtime descriptor requirementRef is required', 'provide_requirement_ref')),
    capability_slices: descriptor.capabilitySlices.map(toCapabilitySliceWire),
    asset_bindings: descriptor.assetBindings?.map(toAssetBindingWire),
    default_params: descriptor.defaultParams,
    editable_fields: descriptor.editableFields,
    prepare_requirements: descriptor.prepareRequirements,
    contract_states: descriptor.contractStates,
    projection_warnings: descriptor.projectionWarnings,
  }) as NimiRuntimeProfileDescriptorWire;
}

export function stringifyNimiRuntimeProfileDescriptor(descriptor: NimiRuntimeProfileDescriptor): string {
  return JSON.stringify(toNimiRuntimeProfileDescriptorWire(descriptor));
}

export function serializeNimiRuntimeProfileDescriptor(descriptor: NimiRuntimeProfileDescriptor): Uint8Array {
  return new TextEncoder().encode(stringifyNimiRuntimeProfileDescriptor(descriptor));
}

function toCapabilitySliceWire(slice: NimiRuntimeProfileDescriptorCapabilitySlice): NimiRuntimeProfileDescriptorCapabilitySliceWire {
  const executionMode = slice.executionMode;
  assertReadinessPolicy(slice.readinessPolicy, `runtime descriptor slice ${slice.sliceId || '<unknown>'} readinessPolicy`);
  assertContractState(slice.contractState, `runtime descriptor slice ${slice.sliceId || '<unknown>'} contractState`);
  assertOptionalTextArray(slice.assetRefs, `runtime descriptor slice ${slice.sliceId || '<unknown>'} assetRefs`);
  assertOrderedCompanionOccurrences(slice);
  const base = dropUndefined({
    slice_id: requireNonEmptyText(slice.sliceId, 'runtime descriptor sliceId is required', 'provide_runtime_descriptor_slice_id'),
    capability: requireNonEmptyText(slice.capability, 'runtime descriptor capability is required', 'provide_runtime_descriptor_capability'),
    execution_mode: executionMode,
    contract_state: slice.contractState,
    readiness_policy: slice.readinessPolicy,
    params_ref: requireNonEmptyText(slice.paramsRef, 'runtime descriptor paramsRef is required', 'provide_runtime_descriptor_params_ref'),
    runtime_consumer_id: slice.runtimeConsumerId,
    consumer_id: slice.consumerId,
    consumer_scope: slice.consumerScope,
    execution: slice.execution ? toExecutionWire(slice.execution) : undefined,
    model: slice.model ? { family: requireNonEmptyText(slice.model.family, 'runtime descriptor model.family is required', 'provide_runtime_descriptor_model_family') } : undefined,
    provider: slice.provider,
    provider_capability: slice.providerCapability,
    model_id: slice.modelId,
    credential_policy: slice.credentialPolicy,
    connector_selector: slice.connectorSelector,
    params_schema_ref: slice.paramsSchemaRef,
    asset_refs: slice.assetRefs,
    ordered_companion_occurrences: slice.orderedCompanionOccurrences?.map(toCompanionWire),
    params_digest: slice.paramsDigest,
    environment_digest: slice.environmentDigest,
  });

  if (executionMode === 'local') {
    if (!base.execution?.backend || !base.model?.family) {
      throw aiConfigError(
        'SDK_AI_RUNTIME_DESCRIPTOR_INVALID',
        `runtime descriptor local slice ${slice.sliceId} requires execution.backend and model.family`,
        'provide_local_runtime_descriptor_fields',
      );
    }
  } else if (executionMode === 'cloud_connector') {
    if (!base.provider || !base.provider_capability || !base.model_id || !base.credential_policy) {
      throw aiConfigError(
        'SDK_AI_RUNTIME_DESCRIPTOR_INVALID',
        `runtime descriptor cloud slice ${slice.sliceId} requires provider/model/credential fields`,
        'provide_cloud_runtime_descriptor_fields',
      );
    }
  } else {
    throw aiConfigError(
      'SDK_AI_RUNTIME_DESCRIPTOR_INVALID',
      `runtime descriptor executionMode is invalid: ${String(executionMode)}`,
      'use_supported_runtime_descriptor_execution_mode',
    );
  }
  return base as NimiRuntimeProfileDescriptorCapabilitySliceWire;
}

function toExecutionWire(execution: NimiRuntimeProfileDescriptorExecution): NimiRuntimeProfileDescriptorExecutionWire {
  return dropUndefined({
    backend: execution.backend,
    backend_class: execution.backendClass,
    backend_family: execution.backendFamily,
    consumer_id: execution.consumerId,
    consumer_scope: execution.consumerScope,
  }) as NimiRuntimeProfileDescriptorExecutionWire;
}

function toCompanionWire(
  occurrence: NimiRuntimeProfileDescriptorCompanionOccurrence,
): NimiRuntimeProfileDescriptorCompanionOccurrenceWire {
  return dropUndefined({
    occurrence_id: requireNonEmptyText(occurrence.occurrenceId, 'runtime descriptor companion occurrenceId is required', 'provide_companion_occurrence_id'),
    order: occurrence.order,
    role: requireNonEmptyText(occurrence.role, 'runtime descriptor companion role is required', 'provide_companion_role'),
    engineSlot: requireNonEmptyText(occurrence.engineSlot, 'runtime descriptor companion engineSlot is required', 'provide_companion_engine_slot'),
    asset_binding_ref: requireNonEmptyText(occurrence.assetBindingRef, 'runtime descriptor companion assetBindingRef is required', 'provide_companion_asset_binding_ref'),
    required: occurrence.required,
    weight: occurrence.weight,
    options: occurrence.options,
    applies_to: occurrence.appliesTo,
  }) as NimiRuntimeProfileDescriptorCompanionOccurrenceWire;
}

function toAssetBindingWire(binding: NimiRuntimeProfileDescriptorAssetBinding): NimiRuntimeProfileDescriptorAssetBindingWire {
  const source = binding.source;
  assertReadinessPolicy(binding.readinessPolicy, `runtime descriptor asset binding ${binding.bindingId || '<unknown>'} readinessPolicy`);
  const wire = dropUndefined({
    binding_id: requireNonEmptyText(binding.bindingId, 'runtime descriptor asset bindingId is required', 'provide_asset_binding_id'),
    asset_role: requireNonEmptyText(binding.assetRole, 'runtime descriptor asset role is required', 'provide_asset_role'),
    component_kind: requireNonEmptyText(binding.componentKind, 'runtime descriptor componentKind is required', 'provide_component_kind'),
    source,
    expected_identity: requireNonEmptyText(binding.expectedIdentity, 'runtime descriptor expectedIdentity is required', 'provide_expected_asset_identity'),
    readiness_policy: binding.readinessPolicy,
    huggingface: binding.huggingFace ? toHuggingFaceWire(binding.huggingFace) : undefined,
    manual: binding.manual ? toManualWire(binding.manual) : undefined,
  });
  if (source === 'huggingface' && !wire.huggingface) {
    throw aiConfigError('SDK_AI_RUNTIME_DESCRIPTOR_INVALID', `asset binding ${binding.bindingId} requires huggingFace source fields`, 'provide_huggingface_asset_source');
  }
  if (source === 'manual' && !wire.manual) {
    throw aiConfigError('SDK_AI_RUNTIME_DESCRIPTOR_INVALID', `asset binding ${binding.bindingId} requires manual source fields`, 'provide_manual_asset_source');
  }
  if (source !== 'huggingface' && source !== 'manual') {
    throw aiConfigError('SDK_AI_RUNTIME_DESCRIPTOR_INVALID', `asset binding ${binding.bindingId} has invalid source`, 'use_supported_asset_source');
  }
  return wire as NimiRuntimeProfileDescriptorAssetBindingWire;
}

function toHuggingFaceWire(
  source: NonNullable<NimiRuntimeProfileDescriptorAssetBinding['huggingFace']>,
): NimiRuntimeProfileDescriptorHuggingFaceSourceWire {
  assertNonEmptyArray(source.entries, 'Hugging Face entries', 'provide_huggingface_entry');
  if (!['public', 'requires_auth', 'gated', 'unknown'].includes(source.accessPolicy)) {
    throw aiConfigError('SDK_AI_RUNTIME_DESCRIPTOR_INVALID', 'Hugging Face accessPolicy is invalid', 'use_supported_huggingface_access_policy');
  }
  return dropUndefined({
    repo_id: requireNonEmptyText(source.repoId, 'Hugging Face repoId is required', 'provide_huggingface_repo_id'),
    revision: requireNonEmptyText(source.revision, 'Hugging Face revision is required', 'provide_huggingface_revision'),
    entries: source.entries.map((entry) => requireNonEmptyText(entry, 'Hugging Face entry is required', 'provide_huggingface_entry')),
    access_policy: source.accessPolicy,
    repo_type: source.repoType,
    format: source.format,
    variant: source.variant,
    expected_integrity: source.expectedIntegrity,
  }) as NimiRuntimeProfileDescriptorHuggingFaceSourceWire;
}

function toManualWire(
  source: NonNullable<NimiRuntimeProfileDescriptorAssetBinding['manual']>,
): NimiRuntimeProfileDescriptorManualSourceWire {
  assertOptionalTextArray(source.allowedFilePatterns, 'manual asset allowedFilePatterns');
  return dropUndefined({
    expected_name: requireNonEmptyText(source.expectedName, 'manual asset expectedName is required', 'provide_manual_expected_name'),
    association_instructions: requireNonEmptyText(source.associationInstructions, 'manual asset associationInstructions are required', 'provide_manual_association_instructions'),
    expected_format: source.expectedFormat,
    allowed_file_patterns: source.allowedFilePatterns,
    expected_integrity: source.expectedIntegrity,
    risk_label: source.riskLabel,
  }) as NimiRuntimeProfileDescriptorManualSourceWire;
}

function assertDescriptorPortable(descriptor: NimiRuntimeProfileDescriptor): void {
  const errors = collectForbiddenPayloadErrors(descriptor, 'runtimeDescriptor');
  if (errors.length > 0) {
    throw aiConfigError(
      'SDK_AI_RUNTIME_DESCRIPTOR_INVALID',
      `runtime descriptor contains forbidden Runtime evidence: ${errors.join('; ')}`,
      'remove_runtime_evidence_from_descriptor',
    );
  }
}

function validateRequirementSlice(slice: NimiAICapabilityRequirementSlice, path: string): string[] {
  const errors = collectForbiddenPayloadErrors(slice, path);
  if (!slice || typeof slice !== 'object') {
    errors.push(`${path} must be an object`);
    return errors;
  }
  if (!isNonEmptyText(slice.requirementSliceId)) errors.push(`${path}.requirementSliceId is required`);
  if (!isNonEmptyText(slice.capability)) errors.push(`${path}.capability is required`);
  if (!isNonEmptyText(slice.profileSliceRef)) errors.push(`${path}.profileSliceRef is required`);
  if (slice.readinessPolicy !== 'required' && slice.readinessPolicy !== 'optional') {
    errors.push(`${path}.readinessPolicy is invalid`);
  }
  validateOptionalTextArray(slice.editableFieldRefs, `${path}.editableFieldRefs`, errors);
  if (slice.runtimeDescriptorRef !== undefined && !isNonEmptyText(slice.runtimeDescriptorRef)) {
    errors.push(`${path}.runtimeDescriptorRef must be a non-empty string when provided`);
  }
  return errors;
}

function resolveRuntimeActivationConsumers(
  declaration: NimiAICapabilityRequirementDeclaration,
  slices: readonly NimiAICapabilityRequirementSlice[],
): Map<string, NimiAIRuntimeActivationConsumerRef> {
  const consumers = declaration.runtimeActivationConsumers ?? [];
  const out = new Map<string, NimiAIRuntimeActivationConsumerRef>();
  if (consumers.length === 0) {
    return out;
  }
  const sliceIds = new Set(slices.map((slice) => slice.requirementSliceId));
  const singleSliceId = slices.length === 1 ? slices[0]?.requirementSliceId : undefined;
  for (const consumer of consumers) {
    const targetSliceId = consumer.requirementSliceId ?? singleSliceId;
    if (!targetSliceId) {
      throw aiConfigError(
        'SDK_AI_REQUIREMENT_INVALID',
        'runtimeActivationConsumers without requirementSliceId are ambiguous for multi-slice declarations',
        'provide_runtime_activation_requirement_slice_id',
      );
    }
    if (!sliceIds.has(targetSliceId)) {
      throw aiConfigError(
        'SDK_AI_REQUIREMENT_INVALID',
        `runtimeActivationConsumer references unknown requirementSliceId: ${targetSliceId}`,
        'use_existing_requirement_slice_id',
      );
    }
    if (out.has(targetSliceId)) {
      throw aiConfigError(
        'SDK_AI_REQUIREMENT_INVALID',
        `runtimeActivationConsumers contains duplicate mapping for requirementSliceId: ${targetSliceId}`,
        'deduplicate_runtime_activation_consumers',
      );
    }
    out.set(targetSliceId, consumer);
  }
  return out;
}

function isRuntimeActivationConsumer(value: NimiAIRuntimeActivationConsumerRef): boolean {
  return Boolean(value && typeof value === 'object' && isNonEmptyText(value.consumerId));
}

function assertOrderedCompanionOccurrences(slice: NimiRuntimeProfileDescriptorCapabilitySlice): void {
  const occurrences = slice.orderedCompanionOccurrences;
  if (occurrences === undefined) {
    return;
  }
  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();
  for (const occurrence of occurrences) {
    if (!Number.isInteger(occurrence.order) || occurrence.order < 0 || occurrence.order >= occurrences.length) {
      throw aiConfigError(
        'SDK_AI_RUNTIME_DESCRIPTOR_INVALID',
        `runtime descriptor companion occurrence ${occurrence.occurrenceId || '<unknown>'} has invalid order`,
        'provide_ordered_companion_occurrence_order',
      );
    }
    const occurrenceId = requireNonEmptyText(
      occurrence.occurrenceId,
      'runtime descriptor companion occurrenceId is required',
      'provide_companion_occurrence_id',
    );
    if (seenIds.has(occurrenceId)) {
      throw aiConfigError(
        'SDK_AI_RUNTIME_DESCRIPTOR_INVALID',
        `runtime descriptor companion occurrence is duplicated: ${occurrenceId}`,
        'deduplicate_companion_occurrences',
      );
    }
    seenIds.add(occurrenceId);
    if (seenOrders.has(occurrence.order)) {
      throw aiConfigError(
        'SDK_AI_RUNTIME_DESCRIPTOR_INVALID',
        `runtime descriptor companion occurrence order is duplicated: ${occurrence.order}`,
        'deduplicate_companion_occurrence_order',
      );
    }
    seenOrders.add(occurrence.order);
  }
}

function assertReadinessPolicy(value: unknown, path: string): void {
  if (value === 'required' || value === 'optional') {
    return;
  }
  throw aiConfigError('SDK_AI_RUNTIME_DESCRIPTOR_INVALID', `${path} is invalid`, 'use_supported_readiness_policy');
}

function assertContractState(value: unknown, path: string): void {
  if (value === 'declared' || value === 'proposed' || value === 'unsupported') {
    return;
  }
  throw aiConfigError('SDK_AI_RUNTIME_DESCRIPTOR_INVALID', `${path} is invalid`, 'use_supported_contract_state');
}

function assertNonEmptyArray(value: readonly unknown[] | undefined, label: string, actionRef: string): void {
  if (Array.isArray(value) && value.length > 0) {
    return;
  }
  throw aiConfigError('SDK_AI_RUNTIME_DESCRIPTOR_INVALID', `${label} must be a non-empty array`, actionRef);
}

function assertOptionalTextArray(value: readonly unknown[] | undefined, path: string): void {
  const errors: string[] = [];
  validateOptionalTextArray(value, path, errors);
  if (errors.length > 0) {
    throw aiConfigError('SDK_AI_RUNTIME_DESCRIPTOR_INVALID', errors.join('; '), 'provide_runtime_descriptor_text_refs');
  }
}

function validateOptionalTextArray(value: readonly unknown[] | undefined, path: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array when provided`);
    return;
  }
  value.forEach((item, index) => {
    if (!isNonEmptyText(item)) {
      errors.push(`${path}[${index}] must be a non-empty string`);
    }
  });
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function dropUndefined<T extends object>(value: T): Partial<T> {
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) {
      output[key] = child;
    }
  }
  return output as Partial<T>;
}
