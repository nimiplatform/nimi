import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createRuntimeProtectedScopeHelper,
  type AgentPresentationBackendKind,
  type SetAgentPresentationProfileRequest,
} from '@nimiplatform/sdk/runtime';
import type { AvatarPresentationProfile } from '@nimiplatform/kit/features/avatar/headless';
import { normalizeRuntimeError, normalizeText } from './runtime-agent-inspect-projection';

type RuntimeClient = ReturnType<typeof getPlatformClient>['runtime'];

type RuntimeAgentPresentationProfileDeps = {
  getRuntime?: () => RuntimeClient;
  getSubjectUserId?: () => string | undefined | Promise<string | undefined>;
};

export function normalizeRuntimeAgentPresentationBackendKind(
  value: AvatarPresentationProfile['backendKind'],
): AgentPresentationBackendKind | null {
  switch (value) {
    case 'vrm':
      return 1;
    case 'live2d':
      return 2;
    default:
      return null;
  }
}

const RUNTIME_AGENT_PRESENTATION_VOICE_REFERENCE_PREFIXES = [
  'preset_voice_id:',
  'voice_asset_id:',
  'provider_voice_ref:',
];

export function normalizeRuntimeAgentPresentationDefaultVoiceReference(
  value: string | null | undefined,
): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  return RUNTIME_AGENT_PRESENTATION_VOICE_REFERENCE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    ? normalized
    : '';
}

function toSetPresentationProfileRequest(input: {
  context: {
    appId: string;
    subjectUserId: string;
    ownerUserId: string;
    realmAgentId: string;
    localAgentRef: string;
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
  const backendKind = normalizeRuntimeAgentPresentationBackendKind(input.profile.backendKind);
  const avatarAssetRef = normalizeText(input.profile.avatarAssetRef);
  if (!backendKind || !avatarAssetRef) {
    throw new Error('AGENT_PRESENTATION_PROFILE_INVALID');
  }
  return {
    context: input.context,
    agentId: input.agentId,
    mutation: {
      oneofKind: 'profile',
      profile: {
        backendKind,
        avatarAssetRef,
        expressionProfileRef: input.profile.expressionProfileRef || '',
        idlePreset: input.profile.idlePreset || '',
        interactionPolicyRef: input.profile.interactionPolicyRef || '',
        defaultVoiceReference: normalizeRuntimeAgentPresentationDefaultVoiceReference(input.profile.defaultVoiceReference),
      },
    },
  };
}

function parseLocalAgentIdentity(localAgentRef: string) {
  const normalized = normalizeText(localAgentRef);
  const parts = normalized.split(':');
  if (parts.length !== 3 || parts[0] !== 'local-agent' || !parts[1] || !parts[2]) {
    throw new Error('runtime agent presentation profile requires localAgentRef formatted as local-agent:${ownerUserId}:${realmAgentId}');
  }
  return {
    ownerUserId: parts[1],
    realmAgentId: parts[2],
    localAgentRef: normalized,
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
              ...parseLocalAgentIdentity(normalizedAgentId),
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
