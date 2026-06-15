import {
  createNimiHostRuntimeAgentPresentationProfileSurface,
  type NimiHostRuntimeAgentPresentationProfileClient,
  type NimiHostRuntimeAgentPresentationProfileSurfaceOptions,
} from '@nimiplatform/sdk/runtime';
import type { AvatarPresentationProfile } from '@nimiplatform/kit/features/avatar/headless';
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
    async setPresentationProfile(agentId: string, profile: AvatarPresentationProfile | null): Promise<void> {
      await surface.setPresentationProfile(agentId, profile);
    },
  };
}
