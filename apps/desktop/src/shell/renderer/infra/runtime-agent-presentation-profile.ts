import {
  createNimiHostRuntimeAgentPresentationProfileSurface,
  type NimiHostRuntimeAgentPresentationProfileClient,
  type NimiHostRuntimeAgentPresentationProfileSurfaceOptions,
  type NimiRuntimeAgentPresentationProfileInput,
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
    ): Promise<void> {
      await surface.setPresentationProfile(identity, profile);
    },
    async patchPresentationProfile(
      identity: RuntimeLocalAgentIdentityInput,
      patch: NimiRuntimeAgentPresentationProfilePatchInput,
    ): Promise<void> {
      await surface.patchPresentationProfile(identity, patch);
    },
  };
}
