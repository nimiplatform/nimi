import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createRuntimeProtectedScopeHelper,
  type AgentPresentationBackendKind,
  type SetAgentPresentationProfileRequest,
} from '@nimiplatform/sdk/runtime';
import type { AvatarPresentationProfile } from '@nimiplatform/nimi-kit/features/avatar/headless';
import { normalizeRuntimeError, normalizeText } from './runtime-agent-inspect-projection';

type RuntimeClient = ReturnType<typeof getPlatformClient>['runtime'];

type RuntimeAgentPresentationProfileDeps = {
  getRuntime?: () => RuntimeClient;
  getSubjectUserId?: () => string | undefined | Promise<string | undefined>;
};

function toProtoBackendKind(value: AvatarPresentationProfile['backendKind']): AgentPresentationBackendKind {
  switch (value) {
    case 'vrm':
      return 1;
    case 'live2d':
      return 2;
    case 'sprite2d':
      return 3;
    case 'canvas2d':
      return 4;
    case 'video':
      return 5;
    default:
      return 0;
  }
}

function toSetPresentationProfileRequest(input: {
  context: {
    appId: string;
    subjectUserId: string;
  };
  agentId: string;
  profile: AvatarPresentationProfile | null;
}): SetAgentPresentationProfileRequest {
  if (!input.profile) {
    return {
      context: input.context,
      agentId: input.agentId,
      mutation: {
        oneofKind: 'clear',
        clear: {},
      },
    };
  }
  return {
    context: input.context,
    agentId: input.agentId,
    mutation: {
      oneofKind: 'profile',
      profile: {
        backendKind: toProtoBackendKind(input.profile.backendKind),
        avatarAssetRef: input.profile.avatarAssetRef,
        expressionProfileRef: input.profile.expressionProfileRef || '',
        idlePreset: input.profile.idlePreset || '',
        interactionPolicyRef: input.profile.interactionPolicyRef || '',
        defaultVoiceReference: input.profile.defaultVoiceReference || '',
      },
    },
  };
}

export function createRuntimeAgentPresentationProfileAdapter(
  deps: RuntimeAgentPresentationProfileDeps = {},
) {
  const getRuntime = deps.getRuntime ?? (() => getPlatformClient().runtime);
  let protectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

  const resolveSubjectUserId = async (): Promise<string> => {
    const subjectUserId = normalizeText(await deps.getSubjectUserId?.());
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
      const normalizedAgentId = normalizeText(agentId);
      if (!normalizedAgentId) {
        throw new Error('AGENT_ID_REQUIRED');
      }
      const runtime = getRuntime();
      const subjectUserId = await resolveSubjectUserId();
      const protectedScopes = getProtectedAccess();
      try {
        await protectedScopes.withScopes(['runtime.agent.write'], (options) => runtime.agent.setPresentationProfile(
          toSetPresentationProfileRequest({
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
        throw normalizeRuntimeError(error, 'set_runtime_agent_presentation_profile');
      }
    },
  };
}
