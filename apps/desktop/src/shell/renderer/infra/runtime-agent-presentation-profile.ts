import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createHostRuntimeAgentPresentationProfileSurface,
  type HostRuntimeAgentPresentationProfileSurfaceOptions,
} from '@nimiplatform/sdk/runtime';
import type { AvatarPresentationProfile } from '@nimiplatform/kit/features/avatar/headless';

type RuntimeClient = ReturnType<typeof getPlatformClient>['runtime'];

type RuntimeAgentPresentationProfileDeps = {
  getRuntime?: () => RuntimeClient;
  getSubjectUserId?: HostRuntimeAgentPresentationProfileSurfaceOptions['getSubjectUserId'];
};

export function createRuntimeAgentPresentationProfileAdapter(
  deps: RuntimeAgentPresentationProfileDeps = {},
) {
  const surface = createHostRuntimeAgentPresentationProfileSurface({
    getRuntime: deps.getRuntime ?? (() => getPlatformClient().runtime),
    getSubjectUserId: deps.getSubjectUserId ?? (() => undefined),
  });

  return {
    async setPresentationProfile(agentId: string, profile: AvatarPresentationProfile | null): Promise<void> {
      await surface.setPresentationProfile(agentId, profile);
    },
  };
}
