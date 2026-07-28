import type {
  NimiAICapabilityRequirementDeclaration,
  NimiAICapabilityRequirementSlice,
  NimiAIRuntimeActivationConsumerRef,
  NimiAIValidationIssue,
  NimiAIScopeRef,
} from './config-types';
import { areNimiAIScopeRefsEqual, assertNimiAIScopeRef } from './config-scope';
import {
  aiValidationIssue,
  aiConfigError,
  collectForbiddenPayloadIssues,
  formatNimiAIValidationIssues,
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
  const issues = collectForbiddenPayloadIssues(declaration, 'requirementDeclaration');
  requireNonEmptyText(declaration.requirementId, 'requirementId is required', 'provide_ai_requirement_id');
  assertNimiAIScopeRef(declaration.scopeRef);
  requireNonEmptyText(declaration.setupProjectionPolicy, 'setupProjectionPolicy is required', 'provide_setup_projection_policy');
  if (!Array.isArray(declaration.requiredSlices)) {
    throw aiConfigError('SDK_AI_REQUIREMENT_INVALID', 'requiredSlices must be an array', 'provide_required_ai_slices');
  }
  if (declaration.requiredSlices.length === 0) {
    issues.push(aiValidationIssue('AI_FIELD_REQUIRED', 'requirementDeclaration.requiredSlices'));
  }
  if (declaration.optionalSlices !== undefined && !Array.isArray(declaration.optionalSlices)) {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', 'requirementDeclaration.optionalSlices'));
  }
  for (const [index, slice] of declaration.requiredSlices.entries()) {
    issues.push(...validateRequirementSlice(slice, `requirementDeclaration.requiredSlices[${index}]`));
    if (slice.readinessPolicy !== 'required') {
      issues.push(aiValidationIssue(
        'AI_VALUE_INVALID',
        `requirementDeclaration.requiredSlices[${index}].readinessPolicy`,
      ));
    }
  }
  if (Array.isArray(declaration.optionalSlices)) {
    for (const [index, slice] of declaration.optionalSlices.entries()) {
      issues.push(...validateRequirementSlice(slice, `requirementDeclaration.optionalSlices[${index}]`));
      if (slice.readinessPolicy !== 'optional') {
        issues.push(aiValidationIssue(
          'AI_VALUE_INVALID',
          `requirementDeclaration.optionalSlices[${index}].readinessPolicy`,
        ));
      }
    }
  }
  validateOptionalTextArray(declaration.editableFields, 'requirementDeclaration.editableFields', issues);
  validateOptionalTextArray(
    declaration.readinessProjectionRefs,
    'requirementDeclaration.readinessProjectionRefs',
    issues,
  );
  if (declaration.runtimeActivationConsumers !== undefined && !Array.isArray(declaration.runtimeActivationConsumers)) {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', 'requirementDeclaration.runtimeActivationConsumers'));
  }
  if (Array.isArray(declaration.runtimeActivationConsumers)) {
    for (const [index, consumer] of declaration.runtimeActivationConsumers.entries()) {
      issues.push(...validateRuntimeActivationConsumer(
        consumer,
        `requirementDeclaration.runtimeActivationConsumers[${index}]`,
      ));
    }
  }
  if (issues.length > 0) {
    throw aiConfigError(
      'SDK_AI_REQUIREMENT_INVALID',
      `AI capability requirement declaration is invalid: ${formatNimiAIValidationIssues(issues)}`,
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

function validateRequirementSlice(
  slice: NimiAICapabilityRequirementSlice,
  path: string,
): NimiAIValidationIssue[] {
  const issues = collectForbiddenPayloadIssues(slice, path);
  if (!slice || typeof slice !== 'object') {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', path));
    return issues;
  }
  if (!isNonEmptyString(slice.requirementSliceId)) {
    issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${path}.requirementSliceId`));
  }
  if (!isNonEmptyString(slice.capability)) {
    issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${path}.capability`));
  }
  if (!isNonEmptyString(slice.profileSliceRef)) {
    issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${path}.profileSliceRef`));
  }
  if (slice.readinessPolicy !== 'required' && slice.readinessPolicy !== 'optional') {
    issues.push(aiValidationIssue('AI_VALUE_INVALID', `${path}.readinessPolicy`));
  }
  validateOptionalTextArray(slice.editableFieldRefs, `${path}.editableFieldRefs`, issues);
  if (slice.runtimeDescriptorRef !== undefined && !isNonEmptyString(slice.runtimeDescriptorRef)) {
    issues.push(aiValidationIssue('AI_VALUE_INVALID', `${path}.runtimeDescriptorRef`));
  }
  return issues;
}

function validateRuntimeActivationConsumer(
  consumer: NimiAIRuntimeActivationConsumerRef,
  path: string,
): NimiAIValidationIssue[] {
  const issues = collectForbiddenPayloadIssues(consumer, path);
  if (!consumer || typeof consumer !== 'object') {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', path));
    return issues;
  }
  if (!isNonEmptyString(consumer.consumerId)) {
    issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${path}.consumerId`));
  }
  if (consumer.consumerScope !== undefined && !isNonEmptyString(consumer.consumerScope)) {
    issues.push(aiValidationIssue('AI_VALUE_INVALID', `${path}.consumerScope`));
  }
  if (consumer.requirementSliceId !== undefined && !isNonEmptyString(consumer.requirementSliceId)) {
    issues.push(aiValidationIssue('AI_VALUE_INVALID', `${path}.requirementSliceId`));
  }
  return issues;
}

function validateOptionalTextArray(
  value: readonly unknown[] | undefined,
  path: string,
  issues: NimiAIValidationIssue[],
): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', path));
    return;
  }
  value.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      issues.push(aiValidationIssue('AI_VALUE_INVALID', `${path}[${index}]`));
    }
  });
}
