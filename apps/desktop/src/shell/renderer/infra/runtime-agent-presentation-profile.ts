import {
  createNimiHostRuntimeAgentPresentationProfileSurface,
  type NimiHostRuntimeAgentPresentationProfileClient,
  type NimiHostRuntimeAgentPresentationProfileSurfaceOptions,
  type NimiRuntimeAgentPresentationProfileInput,
  type NimiRuntimeAgentPresentationProfileMutationResult,
  type NimiRuntimeAgentPresentationProfilePatchInput,
  type RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/sdk/runtime';
import {
  getDesktopHostRuntimeAgentClient,
  withDesktopRuntimeProtectedScopes,
} from '@renderer/infra/sdk/desktop-nimi-client-session';

type RuntimeAgentPresentationProfileDeps = {
  getRuntime?: () => NimiHostRuntimeAgentPresentationProfileClient;
  getSubjectUserId?: NimiHostRuntimeAgentPresentationProfileSurfaceOptions['getSubjectUserId'];
};

export function createRuntimeAgentPresentationProfileAdapter(
  deps: RuntimeAgentPresentationProfileDeps = {},
) {
  const surface = createNimiHostRuntimeAgentPresentationProfileSurface({
    getRuntime: deps.getRuntime ?? getDesktopHostRuntimeAgentClient,
    getSubjectUserId: deps.getSubjectUserId ?? (() => undefined),
    ...(deps.getRuntime ? {} : { withScopes: withDesktopRuntimeProtectedScopes }),
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
