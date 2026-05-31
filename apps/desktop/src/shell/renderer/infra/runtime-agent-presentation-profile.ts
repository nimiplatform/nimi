import { getPlatformClient } from '@nimiplatform/sdk';
import {
  buildSetRuntimeAgentPresentationProfileRequest,
  createRuntimeProtectedScopeHelper,
  normalizeRuntimeAgentError,
  normalizeRuntimeAgentText,
} from '@nimiplatform/sdk/runtime';
import type { AvatarPresentationProfile } from '@nimiplatform/kit/features/avatar/headless';

type RuntimeClient = ReturnType<typeof getPlatformClient>['runtime'];

type RuntimeAgentPresentationProfileDeps = {
  getRuntime?: () => RuntimeClient;
  getSubjectUserId?: () => string | undefined | Promise<string | undefined>;
};

export function createRuntimeAgentPresentationProfileAdapter(
  deps: RuntimeAgentPresentationProfileDeps = {},
) {
  const getRuntime = deps.getRuntime ?? (() => getPlatformClient().runtime);
  let protectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

  const resolveSubjectUserId = async (): Promise<string> => {
    const subjectUserId = normalizeRuntimeAgentText(await deps.getSubjectUserId?.());
    if (!subjectUserId) {
      throw new Error('desktop runtime agent presentation profile requires authenticated subject user id');
    }
    return subjectUserId;
  };

  const getProtectedAccess = () => {
    if (protectedAccess) {
      return protectedAccess;
    }
    protectedAccess = createRuntimeProtectedScopeHelper({
      runtime: getRuntime(),
      getSubjectUserId: async () => resolveSubjectUserId(),
    });
    return protectedAccess;
  };

  return {
    async setPresentationProfile(agentId: string, profile: AvatarPresentationProfile | null): Promise<void> {
      const normalizedAgentId = normalizeRuntimeAgentText(agentId);
      if (!normalizedAgentId) {
        throw new Error('AGENT_ID_REQUIRED');
      }
      const runtime = getRuntime();
      const subjectUserId = await resolveSubjectUserId();
      const protectedScopes = getProtectedAccess();
      try {
        await protectedScopes.withScopes(['runtime.agent.write'], (options) => runtime.agent.setPresentationProfile(
          buildSetRuntimeAgentPresentationProfileRequest({
            context: {
              appId: runtime.appId,
              subjectUserId,
            },
            agentId: normalizedAgentId,
            profile,
          }),
          options,
        ));
      } catch (error) {
        throw normalizeRuntimeAgentError(error, 'set_runtime_agent_presentation_profile');
      }
    },
  };
}
