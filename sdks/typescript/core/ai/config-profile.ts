import type { NimiJsonValue } from '../contracts';
import type {
  NimiAccountProfileLibraryOrigin,
  NimiAccountProfileLibraryIndexEntry,
  NimiAccountProfileLibraryProfile,
  NimiAccountProfileLibraryProjection,
  NimiAICapabilityRequirementDeclaration,
  NimiAICapabilityRequirementSlice,
  NimiAIConfig,
  NimiAIConfigApplyOutcome,
  NimiAIConfigSetupProjection,
  NimiAIConfigTargetRef,
  NimiAIProfile,
  NimiAIProfileParseOptions,
  NimiAIProfileValidationResult,
  NimiAIValidationIssue,
  NimiAIProfileCapabilityIntent,
  NimiAIProfilePreviewResult,
  NimiAIScopeRef,
} from './config-types';
import { assertNimiAIScopeRef, createEmptyNimiAIConfig, validateNimiAIConfigTargetRef } from './config-scope';
import { diffNimiAIConfigs, versionNimiAIConfig } from './config-state';
import {
  aiValidationIssue,
  aiConfigError,
  asAIRecord,
  collectForbiddenPayloadIssues,
  formatNimiAIValidationIssue,
  formatNimiAIValidationIssues,
  isNonEmptyString,
  isRecord,
  normalizeText,
  requireArray,
  requireNonEmptyText,
  requireString,
} from './config-internal';
import {
  assertNimiAIRequirementDeclarationsForScope,
  listNimiAIRequirementSlices,
} from './config-requirements';

interface NimiAIReadyRequirementSlice {
  readonly requirementId: string;
  readonly slice: NimiAICapabilityRequirementSlice;
  readonly intent: NimiAIProfileCapabilityIntent & { readonly targetRef: NimiAIConfigTargetRef };
}

interface NimiAIProfileRequirementApplyEvaluation {
  readonly outcome: NimiAIConfigApplyOutcome;
  readonly setupProjection: NimiAIConfigSetupProjection | null;
  readonly readySlices: readonly NimiAIReadyRequirementSlice[];
}

export function validateNimiAIProfile(profile: unknown): NimiAIProfileValidationResult {
  const issues: NimiAIValidationIssue[] = [];
  if (!isRecord(profile)) {
    return {
      valid: false,
      issues: [aiValidationIssue('AI_TYPE_INVALID', 'profile')],
    };
  }
  if (!isNonEmptyString(profile.profileId)) {
    issues.push(aiValidationIssue('AI_FIELD_REQUIRED', 'profile.profileId'));
  }
  if (!isNonEmptyString(profile.title)) {
    issues.push(aiValidationIssue('AI_FIELD_REQUIRED', 'profile.title'));
  }
  if (profile.description !== undefined && typeof profile.description !== 'string') {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', 'profile.description'));
  }
  if (profile.tags !== undefined && !Array.isArray(profile.tags)) {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', 'profile.tags'));
  }
  if (!isRecord(profile.capabilities)) {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', 'profile.capabilities'));
  }
  issues.push(...collectForbiddenPayloadIssues(profile, 'profile'));
  if (isRecord(profile.capabilities)) {
    for (const [capability, intent] of Object.entries(profile.capabilities)) {
      if (intent === undefined || intent === null) {
        continue;
      }
      if (!isRecord(intent)) {
        issues.push(aiValidationIssue('AI_TYPE_INVALID', `profile.capabilities.${capability}`));
        continue;
      }
      if (intent.targetRef !== undefined && intent.targetRef !== null) {
        issues.push(...validateNimiAIConfigTargetRef(
          intent.targetRef,
          `profile.capabilities.${capability}.targetRef`,
        ));
      }
      if (intent.readinessPolicy !== undefined
        && intent.readinessPolicy !== 'required'
        && intent.readinessPolicy !== 'optional') {
        issues.push(aiValidationIssue('AI_VALUE_INVALID', `profile.capabilities.${capability}.readinessPolicy`));
      }
      if (intent.contractState !== undefined
        && intent.contractState !== 'declared'
        && intent.contractState !== 'proposed'
        && intent.contractState !== 'unsupported') {
        issues.push(aiValidationIssue('AI_VALUE_INVALID', `profile.capabilities.${capability}.contractState`));
      }
      issues.push(...validateRuntimeDescriptorSliceInput(
        intent.runtimeDescriptor,
        `profile.capabilities.${capability}.runtimeDescriptor`,
      ));
    }
  }
  return { valid: issues.length === 0, issues };
}

export function parseNimiAIProfile(value: unknown, options: NimiAIProfileParseOptions = {}): NimiAIProfile {
  const label = options.label ?? 'NimiAIProfile payload';
  const record = asAIRecord(value, label);
  const profile: NimiAIProfile = {
    profileId: requireNonEmptyText(record.profileId, `${label} profileId is required`, 'provide_ai_profile_id'),
    title: requireNonEmptyText(record.title, `${label} title is required`, 'provide_ai_profile_title'),
    description: typeof record.description === 'string'
      ? record.description
      : options.allowMissingOptionalFields ? undefined : requireString(record.description, `${label} description`),
    tags: Array.isArray(record.tags)
      ? record.tags.map((tag) => String(tag || '')).filter(Boolean)
      : options.allowMissingOptionalFields ? [] : requireArray(record.tags, `${label} tags`).map(String),
    capabilities: asAIRecord(record.capabilities, `${label} capabilities`) as NimiAIProfile['capabilities'],
    ...(typeof record.version === 'string' ? { version: record.version } : {}),
    ...(typeof record.revision === 'string' ? { revision: record.revision } : {}),
    ...(Array.isArray(record.assetBindings) ? { assetBindings: record.assetBindings as NimiAIProfile['assetBindings'] } : {}),
    ...(isRecord(record.defaultParams) ? { defaultParams: record.defaultParams as NimiAIProfile['defaultParams'] } : {}),
    ...(Array.isArray(record.editableFields) ? { editableFields: record.editableFields.map(String).filter(Boolean) } : {}),
    ...(Array.isArray(record.prepareRequirements) ? { prepareRequirements: record.prepareRequirements.map(String).filter(Boolean) } : {}),
    ...(Array.isArray(record.contractStates) ? { contractStates: record.contractStates.map(String).filter(Boolean) } : {}),
    ...(Array.isArray(record.projectionWarnings) ? { projectionWarnings: record.projectionWarnings.map(String).filter(Boolean) } : {}),
  };
  const validation = validateNimiAIProfile(profile);
  if (!validation.valid) {
    throw aiConfigError(
      'SDK_AI_PROFILE_INVALID',
      `${label} is invalid: ${formatNimiAIValidationIssues(validation.issues)}`,
      'fix_ai_profile_contract',
    );
  }
  return profile;
}

export function parseNimiAccountProfileLibraryOrigin(value: unknown): NimiAccountProfileLibraryOrigin {
  const origin = normalizeText(value);
  if (origin === 'account-default' || origin === 'user' || origin === 'imported') {
    return origin;
  }
  throw aiConfigError(
    'SDK_AI_PROFILE_LIBRARY_INVALID',
    `account profile library origin is invalid: ${origin}`,
    'fix_account_profile_library_origin',
  );
}

export function parseNimiAccountProfileLibraryProfile(value: unknown): NimiAccountProfileLibraryProfile {
  const record = asAIRecord(value, 'account profile library profile');
  const origin = parseNimiAccountProfileLibraryOrigin(record.origin);
  if (origin === 'account-default') {
    throw aiConfigError(
      'SDK_AI_PROFILE_LIBRARY_INVALID',
      'account profile library must not project Account Default Profile as editable profile',
      'keep_account_default_profile_as_host_authority',
    );
  }
  return {
    profileId: normalizeText(record.profileId),
    origin,
    editable: record.editable === true,
    removable: record.removable === true,
    createdAt: normalizeText(record.createdAt),
    updatedAt: normalizeText(record.updatedAt),
    profile: parseNimiAIProfile(record.profile, {
      label: 'account profile library AIProfile',
      allowMissingOptionalFields: true,
    }),
  };
}

export function parseNimiAccountProfileLibraryIndexEntry(value: unknown): NimiAccountProfileLibraryIndexEntry {
  const record = asAIRecord(value, 'account profile library index entry');
  return {
    profileId: normalizeText(record.profileId),
    title: normalizeText(record.title),
    origin: parseNimiAccountProfileLibraryOrigin(record.origin),
    relativePath: normalizeText(record.relativePath),
    editable: record.editable === true,
    removable: record.removable === true,
    updatedAt: normalizeText(record.updatedAt),
  };
}

export function parseNimiAccountProfileLibraryProjection(value: unknown): NimiAccountProfileLibraryProjection {
  const record = asAIRecord(value, 'account profile library');
  const index = asAIRecord(record.index, 'account profile library index');
  return {
    accountId: normalizeText(record.accountId),
    libraryRef: normalizeText(record.libraryRef),
    index: {
      schemaVersion: Number(index.schemaVersion || 0),
      accountId: normalizeText(index.accountId),
      updatedAt: normalizeText(index.updatedAt),
      entries: Array.isArray(index.entries)
        ? index.entries.map(parseNimiAccountProfileLibraryIndexEntry)
        : [],
    },
    profiles: Array.isArray(record.profiles)
      ? record.profiles.map(parseNimiAccountProfileLibraryProfile)
      : [],
  };
}

export function parseExportedNimiAccountProfileLibraryProfiles(value: unknown): readonly NimiAIProfile[] {
  if (!Array.isArray(value)) {
    throw aiConfigError(
      'SDK_AI_PROFILE_LIBRARY_INVALID',
      'account profile library export must be an array of AIProfile payloads',
      'provide_profile_export_array',
    );
  }
  return value.map((profile) => parseNimiAIProfile(profile, {
    label: 'exported account profile library AIProfile',
    allowMissingOptionalFields: true,
  }));
}

export function projectNimiAIProfileApply(input: {
  readonly scopeRef: NimiAIScopeRef;
  readonly profile: NimiAIProfile;
  readonly requirementDeclarations: readonly NimiAICapabilityRequirementDeclaration[];
}): {
  readonly outcome: NimiAIConfigApplyOutcome;
  readonly setupProjection: NimiAIConfigSetupProjection | null;
} {
  const evaluation = evaluateNimiAIProfileRequirementApply(input);
  return {
    outcome: evaluation.outcome,
    setupProjection: evaluation.setupProjection,
  };
}

function evaluateNimiAIProfileRequirementApply(input: {
  readonly scopeRef: NimiAIScopeRef;
  readonly profile: NimiAIProfile;
  readonly requirementDeclarations: readonly NimiAICapabilityRequirementDeclaration[];
}): NimiAIProfileRequirementApplyEvaluation {
  const declarations = assertNimiAIRequirementDeclarationsForScope({
    scopeRef: input.scopeRef,
    requirementDeclarations: input.requirementDeclarations,
  });
  const selections = listNimiAIRequirementSlices(declarations);
  const blockingCapabilities: string[] = [];
  const actionRefs: string[] = [];
  const reasonCodes: string[] = [];
  const readySlices: NimiAIReadyRequirementSlice[] = [];
  const readyCapabilities = new Set<string>();

  for (const selection of selections.required) {
    const intent = input.profile.capabilities[selection.slice.capability] ?? null;
    const blockedReason = classifyRequirementSliceBlocker(selection.slice, intent);
    if (blockedReason) {
      blockingCapabilities.push(selection.slice.capability);
      actionRefs.push(`setup:${selection.slice.requirementSliceId}`);
      reasonCodes.push(blockedReason);
      continue;
    }
    addReadyRequirementSlice(readySlices, readyCapabilities, selection.requirementId, selection.slice, intent);
  }

  for (const selection of selections.optional) {
    const intent = input.profile.capabilities[selection.slice.capability] ?? null;
    if (classifyRequirementSliceBlocker(selection.slice, intent)) {
      continue;
    }
    addReadyRequirementSlice(readySlices, readyCapabilities, selection.requirementId, selection.slice, intent);
  }

  if (blockingCapabilities.length === 0) {
    return { outcome: 'ready_to_apply', setupProjection: null, readySlices };
  }
  const unsupported = reasonCodes.includes('product_state_unsupported');
  const outcome = unsupported ? 'unsupported_no_live_config' : 'setup_required_no_live_config';
  return {
    outcome,
    setupProjection: {
      outcome,
      blockingCapabilities,
      reasonCodes: [...new Set(reasonCodes)],
      actionRefs,
    },
    readySlices,
  };
}

export function applyNimiAIProfileToConfig(input: {
  readonly config: NimiAIConfig;
  readonly profile: NimiAIProfile;
  readonly requirementDeclarations: readonly NimiAICapabilityRequirementDeclaration[];
  readonly now?: () => string;
}): NimiAIConfig {
  const validation = validateNimiAIProfile(input.profile);
  if (!validation.valid) {
    throw aiConfigError(
      'SDK_AI_PROFILE_INVALID',
      `AI profile is invalid: ${formatNimiAIValidationIssues(validation.issues)}`,
      'fix_ai_profile_contract',
    );
  }
  const evaluation = evaluateNimiAIProfileRequirementApply({
    scopeRef: input.config.scopeRef,
    profile: input.profile,
    requirementDeclarations: input.requirementDeclarations,
  });
  if (evaluation.outcome !== 'ready_to_apply') {
    throw aiConfigError(
      'SDK_AI_PROFILE_NOT_APPLYABLE',
      `AI profile cannot produce live config: ${evaluation.setupProjection?.reasonCodes.join(', ')}`,
      'resolve_required_ai_profile_slices',
    );
  }
  const targetRefs: Record<string, NimiAIConfigTargetRef> = {};
  const selectedParams: Record<string, NimiJsonValue> = {};
  for (const { slice, intent } of evaluation.readySlices) {
    targetRefs[slice.capability] = intent.targetRef;
    if (intent.params !== undefined) {
      selectedParams[slice.capability] = intent.params;
    }
  }
  return {
    scopeRef: assertNimiAIScopeRef(input.config.scopeRef),
    capabilities: {
      targetRefs,
      selectedParams,
    },
    profileOrigin: {
      profileId: input.profile.profileId,
      title: input.profile.title,
      appliedAt: (input.now ?? (() => new Date().toISOString()))(),
    },
  };
}

export function previewNimiAIProfileApply(input: {
  readonly before: NimiAIConfig | null;
  readonly scopeRef: NimiAIScopeRef;
  readonly profile: NimiAIProfile;
  readonly requirementDeclarations: readonly NimiAICapabilityRequirementDeclaration[];
  readonly now?: () => string;
}): NimiAIProfilePreviewResult {
  const validation = validateNimiAIProfile(input.profile);
  if (!validation.valid) {
    return {
      before: input.before,
      after: null,
      outcome: 'invalid_profile',
      diff: diffNimiAIConfigs(input.before, null),
      baseVersion: versionNimiAIConfig(input.before ?? createEmptyNimiAIConfig(input.scopeRef)),
      probeWarnings: validation.issues.map(formatNimiAIValidationIssue),
    };
  }
  const projection = projectNimiAIProfileApply({
    scopeRef: input.scopeRef,
    profile: input.profile,
    requirementDeclarations: input.requirementDeclarations,
  });
  const base = input.before ?? createEmptyNimiAIConfig(input.scopeRef);
  if (projection.outcome !== 'ready_to_apply') {
    return {
      before: input.before,
      after: null,
      outcome: projection.outcome,
      setupProjection: projection.setupProjection,
      diff: diffNimiAIConfigs(input.before, null),
      baseVersion: versionNimiAIConfig(base),
      probeWarnings: [],
    };
  }
  const after = applyNimiAIProfileToConfig({
    config: base,
    profile: input.profile,
    requirementDeclarations: input.requirementDeclarations,
    now: input.now,
  });
  return {
    before: input.before,
    after,
    outcome: 'ready_to_apply',
    setupProjection: null,
    diff: diffNimiAIConfigs(input.before, after),
    baseVersion: versionNimiAIConfig(base),
    probeWarnings: [],
  };
}

function classifyRequirementSliceBlocker(
  slice: NimiAICapabilityRequirementSlice,
  intent: NimiAIProfileCapabilityIntent | null | undefined,
): 'required_slice_unresolved' | 'product_state_unsupported' | 'product_state_proposed' | null {
  if (!intent) {
    return 'required_slice_unresolved';
  }
  const contractState = intent.contractState ?? 'declared';
  if (contractState === 'unsupported') {
    return 'product_state_unsupported';
  }
  if (contractState === 'proposed') {
    return 'product_state_proposed';
  }
  if (!intent.targetRef) {
    return 'required_slice_unresolved';
  }
  return null;
}

function addReadyRequirementSlice(
  readySlices: NimiAIReadyRequirementSlice[],
  readyCapabilities: Set<string>,
  requirementId: string,
  slice: NimiAICapabilityRequirementSlice,
  intent: NimiAIProfileCapabilityIntent | null | undefined,
): void {
  const targetRef = intent?.targetRef;
  if (!intent || !targetRef) {
    return;
  }
  if (readyCapabilities.has(slice.capability)) {
    throw aiConfigError(
      'SDK_AI_REQUIREMENT_INVALID',
      `AIConfig cannot materialize duplicate ready slices for capability: ${slice.capability}`,
      'deduplicate_ai_requirement_capability_slices',
    );
  }
  readyCapabilities.add(slice.capability);
  readySlices.push({ requirementId, slice, intent: { ...intent, targetRef } });
}

function validateRuntimeDescriptorSliceInput(slice: unknown, path: string): readonly NimiAIValidationIssue[] {
  const issues = collectForbiddenPayloadIssues(slice, path);
  if (!slice) {
    return issues;
  }
  if (!isRecord(slice)) {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', path));
    return issues;
  }
  if (slice.executionMode !== undefined && slice.executionMode !== 'local' && slice.executionMode !== 'cloud_connector') {
    issues.push(aiValidationIssue('AI_VALUE_INVALID', `${path}.executionMode`));
  }
  if (slice.contractState !== undefined
    && slice.contractState !== 'declared'
    && slice.contractState !== 'proposed'
    && slice.contractState !== 'unsupported') {
    issues.push(aiValidationIssue('AI_VALUE_INVALID', `${path}.contractState`));
  }
  if (slice.assetRefs !== undefined && !Array.isArray(slice.assetRefs)) {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', `${path}.assetRefs`));
  }
  if (Array.isArray(slice.assetRefs)) {
    slice.assetRefs.forEach((assetRef, index) => {
      if (!isNonEmptyString(assetRef)) {
        issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${path}.assetRefs[${index}]`));
      }
    });
  }
  if (slice.orderedCompanionOccurrences !== undefined && !Array.isArray(slice.orderedCompanionOccurrences)) {
    issues.push(aiValidationIssue('AI_TYPE_INVALID', `${path}.orderedCompanionOccurrences`));
  }
  if (Array.isArray(slice.orderedCompanionOccurrences)) {
    slice.orderedCompanionOccurrences.forEach((occurrence, index) => {
      if (!isRecord(occurrence)) {
        issues.push(aiValidationIssue('AI_TYPE_INVALID', `${path}.orderedCompanionOccurrences[${index}]`));
        return;
      }
      if (!isNonEmptyString(occurrence.occurrenceId)) {
        issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${path}.orderedCompanionOccurrences[${index}].occurrenceId`));
      }
      if (typeof occurrence.order !== 'number' || !Number.isInteger(occurrence.order) || occurrence.order < 0) {
        issues.push(aiValidationIssue('AI_VALUE_INVALID', `${path}.orderedCompanionOccurrences[${index}].order`));
      }
      if (!isNonEmptyString(occurrence.role)) {
        issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${path}.orderedCompanionOccurrences[${index}].role`));
      }
      if (!isNonEmptyString(occurrence.engineSlot)) {
        issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${path}.orderedCompanionOccurrences[${index}].engineSlot`));
      }
      if (!isNonEmptyString(occurrence.assetBindingRef)) {
        issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${path}.orderedCompanionOccurrences[${index}].assetBindingRef`));
      }
      if (typeof occurrence.required !== 'boolean') {
        issues.push(aiValidationIssue('AI_FIELD_REQUIRED', `${path}.orderedCompanionOccurrences[${index}].required`));
      }
    });
  }
  return issues;
}
