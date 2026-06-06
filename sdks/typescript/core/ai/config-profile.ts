import type { NimiJsonValue } from '../contracts';
import type {
  NimiAccountProfileLibraryOrigin,
  NimiAccountProfileLibraryIndexEntry,
  NimiAccountProfileLibraryProfile,
  NimiAccountProfileLibraryProjection,
  NimiAIConfig,
  NimiAIConfigApplyOutcome,
  NimiAIConfigSetupProjection,
  NimiAIConfigTargetRef,
  NimiAIProfile,
  NimiAIProfileParseOptions,
  NimiAIProfileValidationResult,
  NimiAIProfileCapabilityIntent,
  NimiAIProfilePreviewResult,
  NimiAIScopeRef,
} from './config-types';
import { assertNimiAIScopeRef, createEmptyNimiAIConfig, validateNimiAIConfigTargetRef } from './config-scope';
import { diffNimiAIConfigs, versionNimiAIConfig } from './config-state';
import {
  aiConfigError,
  asAIRecord,
  collectForbiddenPayloadErrors,
  isNonEmptyString,
  isRecord,
  normalizeText,
  requireArray,
  requireNonEmptyText,
  requireString,
} from './config-internal';

export function validateNimiAIProfile(profile: unknown): NimiAIProfileValidationResult {
  const errors: string[] = [];
  if (!isRecord(profile)) {
    return { valid: false, errors: ['profile must be a non-null object'] };
  }
  if (!isNonEmptyString(profile.profileId)) errors.push('profileId is required');
  if (!isNonEmptyString(profile.title)) errors.push('title is required');
  if (profile.description !== undefined && typeof profile.description !== 'string') {
    errors.push('description must be a string');
  }
  if (profile.tags !== undefined && !Array.isArray(profile.tags)) {
    errors.push('tags must be an array when provided');
  }
  if (!isRecord(profile.capabilities)) {
    errors.push('capabilities must be a non-null object');
  }
  errors.push(...collectForbiddenPayloadErrors(profile, 'profile'));
  if (isRecord(profile.capabilities)) {
    for (const [capability, intent] of Object.entries(profile.capabilities)) {
      if (intent === undefined || intent === null) {
        continue;
      }
      if (!isRecord(intent)) {
        errors.push(`capabilities.${capability} must be an object when provided`);
        continue;
      }
      if (intent.targetRef !== undefined && intent.targetRef !== null) {
        errors.push(...validateNimiAIConfigTargetRef(intent.targetRef, `capabilities.${capability}.targetRef`));
      }
      if (intent.readinessPolicy !== undefined
        && intent.readinessPolicy !== 'required'
        && intent.readinessPolicy !== 'optional') {
        errors.push(`capabilities.${capability}.readinessPolicy is invalid`);
      }
      if (intent.contractState !== undefined
        && intent.contractState !== 'declared'
        && intent.contractState !== 'proposed'
        && intent.contractState !== 'unsupported') {
        errors.push(`capabilities.${capability}.contractState is invalid`);
      }
      errors.push(...validateRuntimeDescriptorSliceInput(
        intent.runtimeDescriptor,
        `capabilities.${capability}.runtimeDescriptor`,
      ));
    }
  }
  return { valid: errors.length === 0, errors };
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
      `${label} is invalid: ${validation.errors.join('; ')}`,
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

export function projectNimiAIProfileApply(profile: NimiAIProfile): {
  readonly outcome: NimiAIConfigApplyOutcome;
  readonly setupProjection: NimiAIConfigSetupProjection | null;
} {
  const blockingCapabilities: string[] = [];
  const reasonCodes: string[] = [];
  for (const [capability, intent] of Object.entries(profile.capabilities)) {
    if (!intent) {
      continue;
    }
    const readinessPolicy = intent.readinessPolicy ?? 'required';
    const contractState = intent.contractState ?? 'declared';
    if (readinessPolicy !== 'required') {
      continue;
    }
    if (contractState === 'unsupported') {
      blockingCapabilities.push(capability);
      reasonCodes.push('product_state_unsupported');
      continue;
    }
    if (contractState === 'proposed') {
      blockingCapabilities.push(capability);
      reasonCodes.push('product_state_proposed');
      continue;
    }
    if (!intent.targetRef) {
      blockingCapabilities.push(capability);
      reasonCodes.push('required_slice_unresolved');
    }
  }
  if (blockingCapabilities.length === 0) {
    return { outcome: 'ready_to_apply', setupProjection: null };
  }
  const unsupported = reasonCodes.includes('product_state_unsupported');
  const outcome = unsupported ? 'unsupported_no_live_config' : 'setup_required_no_live_config';
  return {
    outcome,
    setupProjection: {
      outcome,
      blockingCapabilities,
      reasonCodes: [...new Set(reasonCodes)],
      actionRefs: blockingCapabilities.map((capability) => `setup:${capability}`),
    },
  };
}

export function applyNimiAIProfileToConfig(
  config: NimiAIConfig,
  profile: NimiAIProfile,
  now: () => string = () => new Date().toISOString(),
): NimiAIConfig {
  const validation = validateNimiAIProfile(profile);
  if (!validation.valid) {
    throw aiConfigError(
      'SDK_AI_PROFILE_INVALID',
      `AI profile is invalid: ${validation.errors.join('; ')}`,
      'fix_ai_profile_contract',
    );
  }
  const projection = projectNimiAIProfileApply(profile);
  if (projection.outcome !== 'ready_to_apply') {
    throw aiConfigError(
      'SDK_AI_PROFILE_NOT_APPLYABLE',
      `AI profile cannot produce live config: ${projection.setupProjection?.reasonCodes.join(', ')}`,
      'resolve_required_ai_profile_slices',
    );
  }
  const targetRefs: Record<string, NimiAIConfigTargetRef> = {};
  const selectedParams: Record<string, NimiJsonValue> = {};
  for (const [capability, intent] of Object.entries(profile.capabilities)) {
    if (!intent) continue;
    if (intent.targetRef) {
      targetRefs[capability] = intent.targetRef;
    }
    if (intent.params !== undefined) {
      selectedParams[capability] = intent.params;
    }
  }
  return {
    scopeRef: assertNimiAIScopeRef(config.scopeRef),
    capabilities: {
      targetRefs,
      selectedParams,
    },
    profileOrigin: {
      profileId: profile.profileId,
      title: profile.title,
      appliedAt: now(),
    },
  };
}

export function previewNimiAIProfileApply(input: {
  readonly before: NimiAIConfig | null;
  readonly scopeRef: NimiAIScopeRef;
  readonly profile: NimiAIProfile;
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
      probeWarnings: validation.errors,
    };
  }
  const projection = projectNimiAIProfileApply(input.profile);
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
  const after = applyNimiAIProfileToConfig(base, input.profile, input.now);
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

function validateRuntimeDescriptorSliceInput(slice: unknown, path: string): readonly string[] {
  const errors = collectForbiddenPayloadErrors(slice, path);
  if (!slice) {
    return errors;
  }
  if (!isRecord(slice)) {
    return [`${path} must be an object`];
  }
  if (slice.executionMode !== undefined && slice.executionMode !== 'local' && slice.executionMode !== 'cloud_connector') {
    errors.push(`${path}.executionMode is invalid`);
  }
  if (slice.contractState !== undefined
    && slice.contractState !== 'declared'
    && slice.contractState !== 'proposed'
    && slice.contractState !== 'unsupported') {
    errors.push(`${path}.contractState is invalid`);
  }
  if (slice.assetRefs !== undefined && !Array.isArray(slice.assetRefs)) {
    errors.push(`${path}.assetRefs must be an array when provided`);
  }
  if (Array.isArray(slice.assetRefs)) {
    slice.assetRefs.forEach((assetRef, index) => {
      if (!isNonEmptyString(assetRef)) {
        errors.push(`${path}.assetRefs[${index}] is required`);
      }
    });
  }
  if (slice.orderedCompanionOccurrences !== undefined && !Array.isArray(slice.orderedCompanionOccurrences)) {
    errors.push(`${path}.orderedCompanionOccurrences must be an array when provided`);
  }
  if (Array.isArray(slice.orderedCompanionOccurrences)) {
    slice.orderedCompanionOccurrences.forEach((occurrence, index) => {
      if (!isRecord(occurrence)) {
        errors.push(`${path}.orderedCompanionOccurrences[${index}] must be an object`);
        return;
      }
      if (!isNonEmptyString(occurrence.occurrenceId)) {
        errors.push(`${path}.orderedCompanionOccurrences[${index}].occurrenceId is required`);
      }
      if (typeof occurrence.order !== 'number' || !Number.isInteger(occurrence.order) || occurrence.order < 0) {
        errors.push(`${path}.orderedCompanionOccurrences[${index}].order is invalid`);
      }
      if (!isNonEmptyString(occurrence.role)) {
        errors.push(`${path}.orderedCompanionOccurrences[${index}].role is required`);
      }
      if (!isNonEmptyString(occurrence.engineSlot)) {
        errors.push(`${path}.orderedCompanionOccurrences[${index}].engineSlot is required`);
      }
      if (!isNonEmptyString(occurrence.assetBindingRef)) {
        errors.push(`${path}.orderedCompanionOccurrences[${index}].assetBindingRef is required`);
      }
      if (typeof occurrence.required !== 'boolean') {
        errors.push(`${path}.orderedCompanionOccurrences[${index}].required is required`);
      }
    });
  }
  return errors;
}
