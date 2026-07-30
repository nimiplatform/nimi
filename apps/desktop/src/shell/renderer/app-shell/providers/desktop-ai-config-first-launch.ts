import {
  assertNimiAppAIScopeRef,
  ensureNimiAppFirstLaunchAIConfig,
  type NimiAICapabilityRequirementDeclaration,
  type NimiAIConfig,
  type NimiAIProfile,
  type NimiAIScopeRef,
  type NimiAppFirstLaunchAIConfigResult,
  type NimiAppManifestRequirementGap,
} from '@nimiplatform/sdk/ai';

export interface EnsureAppFirstLaunchAIConfigInput {
  /** Admitted Nimi App `app_id` (dot-separated namespace identity). */
  readonly appId: string;
  /** Optional app-manifest-declared stable AI feature surface id. */
  readonly surfaceId?: string;
  readonly requirementDeclarations: readonly NimiAICapabilityRequirementDeclaration[];
  /**
   * Optional manifest validation of the materialized AIConfig. Returns the
   * unmet requirement gaps (empty when satisfied). Unmet gaps surface as a
   * typed setup/repair plan; the config is never mutated to force a pass.
   */
  readonly validateManifestRequirements?: (
    scopeRef: NimiAIScopeRef,
    config: NimiAIConfig,
  ) => Promise<NimiAppManifestRequirementGap[]> | NimiAppManifestRequirementGap[];
}

export interface EnsureAppFirstLaunchAIConfigDepsOverride {
  readonly resolveAccountDefaultProfile?: () => Promise<NimiAIProfile | null> | NimiAIProfile | null;
}

export type DesktopAppFirstLaunchAIConfigHost = {
  scopeHasPersistedConfig: (scopeRef: NimiAIScopeRef) => boolean;
  getConfigForScope: (scopeRef: NimiAIScopeRef) => NimiAIConfig;
  commitConfig: (config: NimiAIConfig) => void;
};

async function resolveAccountDefaultProfile(): Promise<NimiAIProfile> {
  throw new Error('desktop-account-default-profile-unavailable');
}

export async function ensureDesktopAppFirstLaunchAIConfig(
  input: EnsureAppFirstLaunchAIConfigInput,
  host: DesktopAppFirstLaunchAIConfigHost,
  deps?: EnsureAppFirstLaunchAIConfigDepsOverride,
): Promise<NimiAppFirstLaunchAIConfigResult> {
  const scopeRef = assertNimiAppAIScopeRef(
    input.surfaceId
      ? { kind: 'app', ownerId: input.appId, surfaceId: input.surfaceId }
      : { kind: 'app', ownerId: input.appId },
  );

  const resolveAccountDefault =
    deps?.resolveAccountDefaultProfile ?? resolveAccountDefaultProfile;

  return ensureNimiAppFirstLaunchAIConfig({
    scopeRef,
    getExistingAppAIConfig: (ref) =>
      host.scopeHasPersistedConfig(ref) ? host.getConfigForScope(ref) : null,
    resolveAccountDefaultProfile: resolveAccountDefault,
    resolveRequirementDeclarations: () => input.requirementDeclarations,
    applyHostAIConfig: (ref, config) => {
      const committed: NimiAIConfig = { ...config, scopeRef: ref };
      host.commitConfig(committed);
      return committed;
    },
    ...(input.validateManifestRequirements
      ? { validateManifestRequirements: input.validateManifestRequirements }
      : {}),
  });
}
