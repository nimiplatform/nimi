import {
  createNimiHostRuntimeAgentPresentationProfileSurface,
  type NimiHostRuntimeAgentPresentationProfileClient,
  type NimiHostRuntimeAgentPresentationProfileSurfaceOptions,
  type NimiRuntimeAgentPresentationProfileInput,
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
    ): Promise<NimiRuntimeAgentPresentationProfileMutationResult> {
      return surface.setPresentationProfile(identity, profile, expectedRevision);
    },
    async patchPresentationProfile(
      identity: RuntimeLocalAgentIdentityInput,
      patch: NimiRuntimeAgentPresentationProfilePatchInput,
      expectedRevision: string,
    ): Promise<NimiRuntimeAgentPresentationProfileMutationResult> {
      return surface.patchPresentationProfile(identity, patch, expectedRevision);
    },
  };
}
