import type {
  NimiAICapabilityRequirementDeclaration,
  NimiAICapabilityRequirementSlice,
  NimiAIRuntimeActivationConsumerRef,
  NimiAIScopeRef,
} from './config-types';
import { areNimiAIScopeRefsEqual, assertNimiAIScopeRef } from './config-scope';
import {
  aiConfigError,
  collectForbiddenPayloadErrors,
  isNonEmptyString,
  requireNonEmptyText,
} from './config-internal';

export interface NimiAIRequirementSliceSelection {
  readonly requirementId: string;
  readonly slice: NimiAICapabilityRequirementSlice;
}

export function assertNimiAICapabilityRequirementDeclaration(
  declaration: NimiAICapabilityRequirementDeclaration,
): void {
  const errors = collectForbiddenPayloadErrors(declaration, 'requirementDeclaration');
  requireNonEmptyText(declaration.requirementId, 'requirementId is required', 'provide_ai_requirement_id');
  assertNimiAIScopeRef(declaration.scopeRef);
  requireNonEmptyText(declaration.setupProjectionPolicy, 'setupProjectionPolicy is required', 'provide_setup_projection_policy');
  if (!Array.isArray(declaration.requiredSlices)) {
    throw aiConfigError('SDK_AI_REQUIREMENT_INVALID', 'requiredSlices must be an array', 'provide_required_ai_slices');
  }
  if (declaration.requiredSlices.length === 0) {
    errors.push('requiredSlices must include at least one slice');
  }
  if (declaration.optionalSlices !== undefined && !Array.isArray(declaration.optionalSlices)) {
    errors.push('optionalSlices must be an array when provided');
  }
  for (const [index, slice] of declaration.requiredSlices.entries()) {
    errors.push(...validateRequirementSlice(slice, `requiredSlices[${index}]`));
    if (slice.readinessPolicy !== 'required') {
      errors.push(`requiredSlices[${index}].readinessPolicy must be required`);
    }
  }
  if (Array.isArray(declaration.optionalSlices)) {
    for (const [index, slice] of declaration.optionalSlices.entries()) {
      errors.push(...validateRequirementSlice(slice, `optionalSlices[${index}]`));
      if (slice.readinessPolicy !== 'optional') {
        errors.push(`optionalSlices[${index}].readinessPolicy must be optional`);
      }
    }
  }
  validateOptionalTextArray(declaration.editableFields, 'editableFields', errors);
  validateOptionalTextArray(declaration.readinessProjectionRefs, 'readinessProjectionRefs', errors);
  if (declaration.runtimeActivationConsumers !== undefined && !Array.isArray(declaration.runtimeActivationConsumers)) {
    errors.push('runtimeActivationConsumers must be an array when provided');
  }
  if (Array.isArray(declaration.runtimeActivationConsumers)) {
    for (const [index, consumer] of declaration.runtimeActivationConsumers.entries()) {
      errors.push(...validateRuntimeActivationConsumer(consumer, `runtimeActivationConsumers[${index}]`));
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

export function assertNimiAIRequirementDeclarationsForScope(input: {
  readonly scopeRef: NimiAIScopeRef;
  readonly requirementDeclarations: readonly NimiAICapabilityRequirementDeclaration[];
}): readonly NimiAICapabilityRequirementDeclaration[] {
  const scopeRef = assertNimiAIScopeRef(input.scopeRef);
  if (!Array.isArray(input.requirementDeclarations) || input.requirementDeclarations.length === 0) {
    throw aiConfigError(
      'SDK_AI_REQUIREMENT_INVALID',
      'AI profile apply requires at least one requirement declaration',
      'provide_ai_requirement_declaration',
    );
  }
  for (const declaration of input.requirementDeclarations) {
    assertNimiAICapabilityRequirementDeclaration(declaration);
    if (!areNimiAIScopeRefsEqual(scopeRef, assertNimiAIScopeRef(declaration.scopeRef))) {
      throw aiConfigError(
        'SDK_AI_REQUIREMENT_SCOPE_MISMATCH',
        `requirement declaration scopeRef does not match apply scopeRef: ${declaration.requirementId}`,
        'use_matching_ai_requirement_scope',
      );
    }
  }
  return input.requirementDeclarations;
}

export function listNimiAIRequirementSlices(
  declarations: readonly NimiAICapabilityRequirementDeclaration[],
): {
  readonly required: readonly NimiAIRequirementSliceSelection[];
  readonly optional: readonly NimiAIRequirementSliceSelection[];
} {
  const required: NimiAIRequirementSliceSelection[] = [];
  const optional: NimiAIRequirementSliceSelection[] = [];
  for (const declaration of declarations) {
    for (const slice of declaration.requiredSlices) {
      required.push({ requirementId: declaration.requirementId, slice });
    }
    for (const slice of declaration.optionalSlices ?? []) {
      optional.push({ requirementId: declaration.requirementId, slice });
    }
  }
  return { required, optional };
}

function validateRequirementSlice(slice: NimiAICapabilityRequirementSlice, path: string): string[] {
  const errors = collectForbiddenPayloadErrors(slice, path);
  if (!slice || typeof slice !== 'object') {
    errors.push(`${path} must be an object`);
    return errors;
  }
  if (!isNonEmptyString(slice.requirementSliceId)) errors.push(`${path}.requirementSliceId is required`);
  if (!isNonEmptyString(slice.capability)) errors.push(`${path}.capability is required`);
  if (!isNonEmptyString(slice.profileSliceRef)) errors.push(`${path}.profileSliceRef is required`);
  if (slice.readinessPolicy !== 'required' && slice.readinessPolicy !== 'optional') {
    errors.push(`${path}.readinessPolicy is invalid`);
  }
  validateOptionalTextArray(slice.editableFieldRefs, `${path}.editableFieldRefs`, errors);
  if (slice.runtimeDescriptorRef !== undefined && !isNonEmptyString(slice.runtimeDescriptorRef)) {
    errors.push(`${path}.runtimeDescriptorRef must be a non-empty string when provided`);
  }
  return errors;
}

function validateRuntimeActivationConsumer(
  consumer: NimiAIRuntimeActivationConsumerRef,
  path: string,
): string[] {
  const errors = collectForbiddenPayloadErrors(consumer, path);
  if (!consumer || typeof consumer !== 'object') {
    return [`${path} must be an object`];
  }
  if (!isNonEmptyString(consumer.consumerId)) {
    errors.push(`${path}.consumerId is required`);
  }
  if (consumer.consumerScope !== undefined && !isNonEmptyString(consumer.consumerScope)) {
    errors.push(`${path}.consumerScope must be a non-empty string when provided`);
  }
  if (consumer.requirementSliceId !== undefined && !isNonEmptyString(consumer.requirementSliceId)) {
    errors.push(`${path}.requirementSliceId must be a non-empty string when provided`);
  }
  return errors;
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
    if (!isNonEmptyString(item)) {
      errors.push(`${path}[${index}] must be a non-empty string`);
    }
  });
}
