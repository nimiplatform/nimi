import { createNimiError } from '../core/errors.js';
import { ReasonCode } from '../types/index.js';
import {
  applyAIProfileToConfig,
  createEmptyAIConfig,
  validateAIProfile,
  type AIConfig,
  type AIProfile,
  type AIScopeRef,
} from './ai-config.js';

export function createAppAIScopeRef(appId: string, surfaceId?: string): AIScopeRef {
  const normalizedAppId = String(appId || '').trim();
  if (!normalizedAppId) {
    throw createNimiError({
      message: 'app-launch AIScopeRef requires an admitted Nimi App app_id',
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_SCOPE_INVALID,
      actionHint: 'provide_admitted_nimi_app_id',
      source: 'sdk',
    });
  }
  const normalizedSurfaceId = surfaceId === undefined ? undefined : String(surfaceId).trim();
  if (normalizedSurfaceId !== undefined && !normalizedSurfaceId) {
    throw createNimiError({
      message: 'app-launch AIScopeRef surfaceId must be a non-empty manifest-declared surface id',
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_SCOPE_INVALID,
      actionHint: 'omit_surface_id_or_pass_manifest_declared_surface_id',
      source: 'sdk',
    });
  }
  return normalizedSurfaceId
    ? { kind: 'app', ownerId: normalizedAppId, surfaceId: normalizedSurfaceId }
    : { kind: 'app', ownerId: normalizedAppId };
}

export function isAppAIScopeRef(scopeRef: AIScopeRef | null | undefined): boolean {
  if (!scopeRef || scopeRef.kind !== 'app') {
    return false;
  }
  if (!String(scopeRef.ownerId || '').trim()) {
    return false;
  }
  return scopeRef.surfaceId === undefined || String(scopeRef.surfaceId).trim().length > 0;
}

export function assertAppAIScopeRef(scopeRef: AIScopeRef | null | undefined): AIScopeRef {
  if (!scopeRef) {
    throw createNimiError({
      message: 'app-launch AIScopeRef is required and must be provided explicitly',
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_SCOPE_INVALID,
      actionHint: 'provide_explicit_app_launch_scope_ref',
      source: 'sdk',
    });
  }
  if (!isAppAIScopeRef(scopeRef)) {
    throw createNimiError({
      message: "app-launch AIScopeRef must be { kind: 'app', ownerId: <admitted app_id>, surfaceId? }",
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_SCOPE_INVALID,
      actionHint: 'use_canonical_app_launch_scope_ref',
      source: 'sdk',
    });
  }
  return createAppAIScopeRef(scopeRef.ownerId, scopeRef.surfaceId);
}

export type AppFirstLaunchProfileSource = 'recommended-profile' | 'account-default-profile';

export type AppManifestRequirementGap = {
  requirementId: string;
  detail: string;
};

export type AppAIConfigSetupRepairPlan = {
  unmetRequirements: AppManifestRequirementGap[];
};

export type AppFirstLaunchAIConfigResult =
  | {
      outcome: 'initialized';
      scopeRef: AIScopeRef;
      config: AIConfig;
      profileSource: AppFirstLaunchProfileSource;
      profileId: string;
      setupRepairPlan: AppAIConfigSetupRepairPlan | null;
    }
  | {
      outcome: 'already-initialized';
      scopeRef: AIScopeRef;
      config: AIConfig;
    };

export type ResolvedRecommendedProfile = {
  profile: AIProfile;
  manifestSatisfied: boolean;
};

export type EnsureAppFirstLaunchAIConfigDeps = {
  scopeRef: AIScopeRef;
  getExistingAppAIConfig: (scopeRef: AIScopeRef) => Promise<AIConfig | null> | AIConfig | null;
  resolveRecommendedProfile: (
    scopeRef: AIScopeRef,
  ) => Promise<ResolvedRecommendedProfile | null> | ResolvedRecommendedProfile | null;
  resolveAccountDefaultProfile: () => Promise<AIProfile | null> | AIProfile | null;
  applyHostAiConfig: (scopeRef: AIScopeRef, config: AIConfig) => Promise<AIConfig> | AIConfig;
  validateManifestRequirements?: (
    scopeRef: AIScopeRef,
    config: AIConfig,
  ) => Promise<AppManifestRequirementGap[]> | AppManifestRequirementGap[];
};

function assertValidProfile(profile: AIProfile, label: string): void {
  const validation = validateAIProfile(profile);
  if (!validation.valid) {
    throw createNimiError({
      message: `${label} is schema-invalid: ${validation.errors.join('; ')}`,
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_INIT_PROFILE_UNRESOLVED,
      actionHint: 'resolve_a_schema_valid_factory_ai_profile',
      source: 'sdk',
    });
  }
}

export async function ensureAppFirstLaunchAIConfig(
  deps: EnsureAppFirstLaunchAIConfigDeps,
): Promise<AppFirstLaunchAIConfigResult> {
  const scopeRef = assertAppAIScopeRef(deps.scopeRef);

  if (typeof deps.getExistingAppAIConfig !== 'function'
    || typeof deps.resolveRecommendedProfile !== 'function'
    || typeof deps.resolveAccountDefaultProfile !== 'function'
    || typeof deps.applyHostAiConfig !== 'function') {
    throw createNimiError({
      message: 'ensureAppFirstLaunchAIConfig requires explicit host resolution authorities',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_existing_config_recommended_default_and_apply_authorities',
      source: 'sdk',
    });
  }

  const existing = await deps.getExistingAppAIConfig(scopeRef);
  if (existing) {
    return { outcome: 'already-initialized', scopeRef, config: existing };
  }

  const recommended = await deps.resolveRecommendedProfile(scopeRef);
  let chosenProfile: AIProfile | null = null;
  let profileSource: AppFirstLaunchProfileSource | null = null;
  if (recommended && recommended.manifestSatisfied) {
    assertValidProfile(recommended.profile, 'app recommended AIProfile');
    chosenProfile = recommended.profile;
    profileSource = 'recommended-profile';
  }

  if (!chosenProfile) {
    const accountDefault = await deps.resolveAccountDefaultProfile();
    if (accountDefault) {
      assertValidProfile(accountDefault, 'Account Default Profile');
      chosenProfile = accountDefault;
      profileSource = 'account-default-profile';
    }
  }

  if (!chosenProfile || !profileSource) {
    throw createNimiError({
      message:
        'app first-launch AIConfig cannot initialize: neither a satisfied recommended '
        + 'profile nor a resolvable Account Default Profile is available',
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_INIT_PROFILE_UNRESOLVED,
      actionHint: 'resolve_recommended_profile_or_account_default_profile',
      source: 'sdk',
    });
  }

  const concurrent = await deps.getExistingAppAIConfig(scopeRef);
  if (concurrent) {
    return { outcome: 'already-initialized', scopeRef, config: concurrent };
  }

  const materialized = applyAIProfileToConfig(createEmptyAIConfig(scopeRef), chosenProfile);
  let committed: AIConfig;
  try {
    committed = await deps.applyHostAiConfig(scopeRef, materialized);
  } catch (error) {
    throw createNimiError({
      message: `app first-launch AIConfig apply failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_INIT_APPLY_FAILED,
      actionHint: 'check_host_ai_config_apply_authority',
      source: 'sdk',
    });
  }
  if (!committed || committed.scopeRef?.kind !== 'app') {
    throw createNimiError({
      message: 'host AIConfig apply authority did not return a committed app-scope AIConfig',
      reasonCode: ReasonCode.SDK_APP_AI_CONFIG_INIT_APPLY_FAILED,
      actionHint: 'host_ai_config_apply_authority_must_return_committed_config',
      source: 'sdk',
    });
  }

  let setupRepairPlan: AppAIConfigSetupRepairPlan | null = null;
  if (typeof deps.validateManifestRequirements === 'function') {
    const gaps = await deps.validateManifestRequirements(scopeRef, committed);
    if (gaps && gaps.length > 0) {
      setupRepairPlan = { unmetRequirements: [...gaps] };
    }
  }

  return {
    outcome: 'initialized',
    scopeRef,
    config: committed,
    profileSource,
    profileId: chosenProfile.profileId,
    setupRepairPlan,
  };
}
