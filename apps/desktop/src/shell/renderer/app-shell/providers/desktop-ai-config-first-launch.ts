import {
  assertAppAIScopeRef,
  ensureAppFirstLaunchAIConfig as ensureAppFirstLaunchAIConfig_sdk,
  type AIConfig,
  type AIProfile,
  type AIScopeRef,
  type AppFirstLaunchAIConfigResult,
  type AppManifestRequirementGap,
} from '@nimiplatform/sdk/ai';
import { loadPlatformAIProfileFactoryCatalog } from '@nimiplatform/sdk/platform-catalog';
import { getAccountDefaultProfileForScopeInit } from '@renderer/bridge/runtime-bridge/product-control.js';

export interface EnsureAppFirstLaunchAIConfigInput {
  /** Admitted Nimi App `app_id` (dot-separated namespace identity). */
  readonly appId: string;
  /** Optional app-manifest-declared stable AI feature surface id. */
  readonly surfaceId?: string;
  /**
   * The app registry row `ai_profile_selection_ref`. Pass the value from the
   * Nimi App registry projection; `null`/omitted when the app declares no
   * recommended profile, which routes init to the Account Default Profile.
   */
  readonly recommendedProfileRef?: string | null;
  /**
   * Whether the app validates its manifest requirements as satisfied by the
   * recommended profile. Defaults to `true` when a recommended profile is
   * resolvable; pass `false` to force the Account Default Profile fallback
   * when the app's manifest requirements are not met by the recommended one.
   */
  readonly recommendedProfileManifestSatisfied?: boolean;
  /**
   * Optional manifest validation of the materialized AIConfig. Returns the
   * unmet requirement gaps (empty when satisfied). Unmet gaps surface as a
   * typed setup/repair plan; the config is never mutated to force a pass.
   */
  readonly validateManifestRequirements?: (
    scopeRef: AIScopeRef,
    config: AIConfig,
  ) => Promise<AppManifestRequirementGap[]> | AppManifestRequirementGap[];
}

export interface EnsureAppFirstLaunchAIConfigDepsOverride {
  readonly resolveRecommendedFactoryProfile?: (
    recommendedProfileRef: string | null | undefined,
  ) => AIProfile | null;
  readonly resolveAccountDefaultProfile?: () => Promise<AIProfile | null> | AIProfile | null;
}

export type DesktopAppFirstLaunchAIConfigHost = {
  scopeHasPersistedConfig: (scopeRef: AIScopeRef) => boolean;
  getConfigForScope: (scopeRef: AIScopeRef) => AIConfig;
  commitConfig: (config: AIConfig) => void;
};

function resolveRecommendedFactoryProfile(
  recommendedProfileRef: string | null | undefined,
): AIProfile | null {
  const ref = String(recommendedProfileRef || '').trim();
  if (!ref) {
    return null;
  }
  return loadPlatformAIProfileFactoryCatalog().find((profile) => profile.profileId === ref) ?? null;
}

async function resolveAccountDefaultProfile(): Promise<AIProfile> {
  const accountDefaultProfile = await getAccountDefaultProfileForScopeInit();
  return {
    profileId: accountDefaultProfile.profileId,
    title: accountDefaultProfile.title,
    description: accountDefaultProfile.description,
    tags: [...accountDefaultProfile.tags],
    capabilities: accountDefaultProfile.capabilities as AIProfile['capabilities'],
  };
}

export async function ensureDesktopAppFirstLaunchAIConfig(
  input: EnsureAppFirstLaunchAIConfigInput,
  host: DesktopAppFirstLaunchAIConfigHost,
  deps?: EnsureAppFirstLaunchAIConfigDepsOverride,
): Promise<AppFirstLaunchAIConfigResult> {
  const scopeRef = assertAppAIScopeRef(
    input.surfaceId
      ? { kind: 'app', ownerId: input.appId, surfaceId: input.surfaceId }
      : { kind: 'app', ownerId: input.appId },
  );

  const resolveRecommended =
    deps?.resolveRecommendedFactoryProfile ?? resolveRecommendedFactoryProfile;
  const resolveAccountDefault =
    deps?.resolveAccountDefaultProfile ?? resolveAccountDefaultProfile;

  return ensureAppFirstLaunchAIConfig_sdk({
    scopeRef,
    getExistingAppAIConfig: (ref) =>
      host.scopeHasPersistedConfig(ref) ? host.getConfigForScope(ref) : null,
    resolveRecommendedProfile: () => {
      const profile = resolveRecommended(input.recommendedProfileRef);
      if (!profile) {
        return null;
      }
      return {
        profile,
        manifestSatisfied: input.recommendedProfileManifestSatisfied !== false,
      };
    },
    resolveAccountDefaultProfile: resolveAccountDefault,
    applyHostAiConfig: (ref, config) => {
      const committed: AIConfig = { ...config, scopeRef: ref };
      host.commitConfig(committed);
      return committed;
    },
    ...(input.validateManifestRequirements
      ? { validateManifestRequirements: input.validateManifestRequirements }
      : {}),
  });
}
