import type {
  NimiAppFirstLaunchAIConfigResult,
  NimiAIConfig,
  NimiAppFirstLaunchProfileSource,
  NimiEnsureAppFirstLaunchAIConfigOptions,
  NimiAIProfile,
  NimiAIScopeRef,
} from './config-types';
import { aiConfigError, formatNimiAIValidationIssues } from './config-internal';
import {
  areNimiAIScopeRefsEqual,
  assertNimiAppAIScopeRef,
  createEmptyNimiAIConfig,
} from './config-scope';
import { ReasonCode } from '../../types';
import { applyNimiAIProfileToConfig, projectNimiAIProfileApply, validateNimiAIProfile } from './config-profile';

export async function ensureNimiAppFirstLaunchAIConfig(
  options: NimiEnsureAppFirstLaunchAIConfigOptions,
): Promise<NimiAppFirstLaunchAIConfigResult> {
  const scopeRef = assertNimiAppAIScopeRef(options.scopeRef);
  assertFirstLaunchAuthorities(options);

  const existing = await options.getExistingAppAIConfig(scopeRef);
  if (existing) {
    return {
      outcome: 'already-initialized',
      scopeRef,
      config: existing,
    };
  }

  const selected = await selectFirstLaunchProfile(options, scopeRef);
  const concurrent = await options.getExistingAppAIConfig(scopeRef);
  if (concurrent) {
    return {
      outcome: 'already-initialized',
      scopeRef,
      config: concurrent,
    };
  }
  const requirementDeclarations = await options.resolveRequirementDeclarations({
    scopeRef,
    profile: selected.profile,
    profileSource: selected.profileSource,
  });

  const projection = projectNimiAIProfileApply({
    scopeRef,
    profile: selected.profile,
    requirementDeclarations,
  });
  if (projection.outcome !== 'ready_to_apply') {
    return {
      outcome: 'setup-required-no-live-config',
      scopeRef,
      config: null,
      profileSource: selected.profileSource,
      profileId: selected.profile.profileId,
      setupRepairPlan: {
        unmetRequirements: (projection.setupProjection?.blockingCapabilities ?? []).map((capability) => ({
          requirementId: capability,
          detail: projection.setupProjection?.reasonCodes.join(', ') || projection.outcome,
        })),
        setupProjection: projection.setupProjection,
      },
    };
  }

  const materialized = applyNimiAIProfileToConfig({
    config: createEmptyNimiAIConfig(scopeRef),
    profile: selected.profile,
    requirementDeclarations,
    now: options.now,
  });
  const materializedGaps = options.validateManifestRequirements
    ? await options.validateManifestRequirements(scopeRef, materialized)
    : [];
  if (materializedGaps.length > 0) {
    return {
      outcome: 'setup-required-no-live-config',
      scopeRef,
      config: null,
      profileSource: selected.profileSource,
      profileId: selected.profile.profileId,
      setupRepairPlan: { unmetRequirements: [...materializedGaps] },
    };
  }
  let committed: NimiAIConfig;
  try {
    committed = await options.applyHostAIConfig(scopeRef, materialized);
  } catch (error) {
    throw aiConfigError(
      'SDK_AI_CONFIG_INIT_APPLY_FAILED',
      `app first-launch AIConfig apply failed: ${error instanceof Error ? error.message : String(error)}`,
      'check_host_ai_config_apply_authority',
    );
  }
  if (!areNimiAIScopeRefsEqual(committed.scopeRef, scopeRef)) {
    throw aiConfigError(
      'SDK_AI_CONFIG_INIT_APPLY_FAILED',
      'host AIConfig apply authority did not return a committed app-scope AIConfig',
      'host_ai_config_apply_authority_must_return_committed_config',
    );
  }

  return {
    outcome: 'initialized',
    scopeRef,
    config: committed,
    profileSource: selected.profileSource,
    profileId: selected.profile.profileId,
    setupRepairPlan: null,
  };
}

function assertFirstLaunchAuthorities(options: NimiEnsureAppFirstLaunchAIConfigOptions): void {
  if (typeof options.getExistingAppAIConfig !== 'function'
    || typeof options.resolveRecommendedProfile !== 'function'
    || typeof options.resolveAccountDefaultProfile !== 'function'
    || typeof options.resolveRequirementDeclarations !== 'function'
    || typeof options.applyHostAIConfig !== 'function') {
    throw aiConfigError(
      ReasonCode.SDK_AI_INPUT_INVALID,
      'ensureNimiAppFirstLaunchAIConfig requires explicit host profile/config/requirement authorities',
      'provide_existing_config_profiles_requirements_and_apply_authorities',
    );
  }
}

async function selectFirstLaunchProfile(
  options: NimiEnsureAppFirstLaunchAIConfigOptions,
  scopeRef: NimiAIScopeRef,
): Promise<{ readonly profile: NimiAIProfile; readonly profileSource: NimiAppFirstLaunchProfileSource }> {
  const recommended = await options.resolveRecommendedProfile(scopeRef);
  if (recommended?.manifestSatisfied) {
    assertValidFirstLaunchProfile(recommended.profile, 'app recommended AIProfile');
    return { profile: recommended.profile, profileSource: 'recommended-profile' };
  }

  const accountDefault = await options.resolveAccountDefaultProfile();
  if (accountDefault) {
    assertValidFirstLaunchProfile(accountDefault, 'Account Default Profile');
    return { profile: accountDefault, profileSource: 'account-default-profile' };
  }

  throw aiConfigError(
    'SDK_AI_CONFIG_INIT_PROFILE_UNRESOLVED',
    'app first-launch AIConfig cannot initialize: no satisfied recommended profile or Account Default Profile is available',
    'resolve_recommended_profile_or_account_default_profile',
  );
}

function assertValidFirstLaunchProfile(profile: NimiAIProfile, label: string): void {
  const validation = validateNimiAIProfile(profile);
  if (!validation.valid) {
    throw aiConfigError(
      'SDK_AI_CONFIG_INIT_PROFILE_UNRESOLVED',
      `${label} is schema-invalid: ${formatNimiAIValidationIssues(validation.issues)}`,
      'resolve_a_schema_valid_ai_profile',
    );
  }
}
