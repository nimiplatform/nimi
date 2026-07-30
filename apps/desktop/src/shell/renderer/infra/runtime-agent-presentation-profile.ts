import {
  createNimiHostRuntimeAgentPresentationProfileSurface,
  type NimiHostRuntimeAgentPresentationProfileClient,
  type NimiHostRuntimeAgentPresentationProfileSurfaceOptions,
  type NimiRuntimeAgentPresentationProfileInput,
  type NimiRuntimeAgentPresentationAssetMaterialInput,
  type NimiRuntimeAgentPresentationProfileMutationResult,
  type NimiRuntimeAgentPresentationProfilePatchInput,
  type NimiRuntimeAgentScopeRunner,
  type RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/sdk/runtime';

type RuntimeAgentPresentationProfileDeps = {
  getRuntime?: () => NimiHostRuntimeAgentPresentationProfileClient;
  getSubjectUserId?: NimiHostRuntimeAgentPresentationProfileSurfaceOptions['getSubjectUserId'];
  withScopes?: NimiRuntimeAgentScopeRunner;
};

function runtimeAgentPresentationUnavailable(): never {
  throw new Error('DESKTOP_RUNTIME_AGENT_PRESENTATION_UNBOUND');
}

export function createRuntimeAgentPresentationProfileAdapter(
  deps: RuntimeAgentPresentationProfileDeps = {},
) {
  const surface = createNimiHostRuntimeAgentPresentationProfileSurface({
    getRuntime: deps.getRuntime ?? runtimeAgentPresentationUnavailable,
    getSubjectUserId: deps.getSubjectUserId ?? (() => undefined),
    ...(deps.withScopes ? { withScopes: deps.withScopes } : {}),
  });

  return {
    async setPresentationProfile(
      identity: RuntimeLocalAgentIdentityInput,
      profile: NimiRuntimeAgentPresentationProfileInput | null,
      expectedRevision: string,
      importedAssets?: readonly NimiRuntimeAgentPresentationAssetMaterialInput[],
    ): Promise<NimiRuntimeAgentPresentationProfileMutationResult> {
      const result = await surface.setPresentationProfile(identity, profile, expectedRevision, importedAssets);
      if (result.outcome === 'committed') return result.projection;
      throw result.outcome === 'conflict' ? result.conflict : result.failure;
    },
    async patchPresentationProfile(
      identity: RuntimeLocalAgentIdentityInput,
      patch: NimiRuntimeAgentPresentationProfilePatchInput,
      expectedRevision: string,
      importedAssets?: readonly NimiRuntimeAgentPresentationAssetMaterialInput[],
    ): Promise<NimiRuntimeAgentPresentationProfileMutationResult> {
      const result = await surface.patchPresentationProfile(identity, patch, expectedRevision, importedAssets);
      if (result.outcome === 'committed') return result.projection;
      throw result.outcome === 'conflict' ? result.conflict : result.failure;
    },
  };
}
