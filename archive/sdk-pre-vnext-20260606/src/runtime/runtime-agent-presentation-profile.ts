import {
  AgentPresentationBackendKind,
  type SetAgentPresentationProfileRequest,
} from './generated/runtime/v1/agent_service.js';
import { buildRuntimeAgentRequestContext } from './local-agent-identity.js';
import { createRuntimeProtectedScopeHelper } from './protected-access.js';
import { normalizeRuntimeAgentError } from './runtime-agent-inspect-projection.js';
import { normalizeRuntimeAgentText } from './runtime-agent-inspect-projection.js';
import type { RuntimeCallOptions, RuntimeTransportConfig } from './types.js';
import type {
  RuntimeAgentClient,
  RuntimeAppAuthClient,
  RuntimeAuthClient,
} from './types-client-interfaces.js';

export type RuntimeAgentPresentationProfileInput = {
  backendKind?: unknown;
  avatarAssetRef?: unknown;
  expressionProfileRef?: unknown;
  idlePreset?: unknown;
  interactionPolicyRef?: unknown;
  defaultVoiceReference?: unknown;
};

export type RuntimeAgentPresentationProfileContext = {
  appId: string;
  subjectUserId: string;
};

type Awaitable<T> = T | Promise<T>;

export type RuntimeAgentPresentationProfileSurface = {
  setPresentationProfile(agentId: string, profile: RuntimeAgentPresentationProfileInput | null): Promise<void>;
};

export type HostRuntimeAgentPresentationProfileClient = {
  readonly appId: string;
  readonly transport?: RuntimeTransportConfig;
  readonly auth: Pick<RuntimeAuthClient, 'registerApp'>;
  readonly appAuth: Pick<RuntimeAppAuthClient, 'authorizeExternalPrincipal'>;
  readonly agent: Pick<RuntimeAgentClient, 'setPresentationProfile'>;
};

export type HostRuntimeAgentPresentationProfileSurfaceOptions = {
  getRuntime: () => HostRuntimeAgentPresentationProfileClient;
  getSubjectUserId: () => Awaitable<string | undefined>;
  withScopes?: <T>(
    scopes: readonly string[],
    operation: (options: RuntimeCallOptions) => Promise<T>,
  ) => Promise<T>;
};

const RUNTIME_AGENT_PRESENTATION_VOICE_REFERENCE_PREFIXES = [
  'preset_voice_id:',
  'voice_asset_id:',
  'provider_voice_ref:',
];

export function normalizeRuntimeAgentPresentationBackendKind(value: unknown): AgentPresentationBackendKind | null {
  switch (normalizeRuntimeAgentText(value).toLowerCase()) {
    case 'vrm':
      return AgentPresentationBackendKind.VRM;
    case 'live2d':
      return AgentPresentationBackendKind.LIVE2D;
    default:
      return null;
  }
}

export function normalizeRuntimeAgentPresentationDefaultVoiceReference(value: unknown): string {
  const normalized = normalizeRuntimeAgentText(value);
  if (!normalized) {
    return '';
  }
  return RUNTIME_AGENT_PRESENTATION_VOICE_REFERENCE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    ? normalized
    : '';
}

export function buildSetRuntimeAgentPresentationProfileRequest(input: {
  context: RuntimeAgentPresentationProfileContext;
  agentId: unknown;
  profile: RuntimeAgentPresentationProfileInput | null | undefined;
}): SetAgentPresentationProfileRequest {
  const agentId = normalizeRuntimeAgentText(input.agentId);
  const appId = normalizeRuntimeAgentText(input.context.appId);
  const subjectUserId = normalizeRuntimeAgentText(input.context.subjectUserId);
  if (!agentId) {
    throw new Error('AGENT_ID_REQUIRED');
  }
  if (!appId || !subjectUserId) {
    throw new Error('RUNTIME_AGENT_PRESENTATION_PROFILE_CONTEXT_REQUIRED');
  }
  const context = buildRuntimeAgentRequestContext({
    runtimeAppId: appId,
    subjectUserId,
    localAgentRef: agentId,
  });
  if (!input.profile) {
    return {
      context,
      agentId,
      mutation: {
        oneofKind: 'clear',
        clear: {},
      },
    };
  }
  const backendKind = normalizeRuntimeAgentPresentationBackendKind(input.profile.backendKind);
  const avatarAssetRef = normalizeRuntimeAgentText(input.profile.avatarAssetRef);
  if (!backendKind || !avatarAssetRef) {
    throw new Error('AGENT_PRESENTATION_PROFILE_INVALID');
  }
  return {
    context,
    agentId,
    mutation: {
      oneofKind: 'profile',
      profile: {
        backendKind,
        avatarAssetRef,
        expressionProfileRef: normalizeRuntimeAgentText(input.profile.expressionProfileRef),
        idlePreset: normalizeRuntimeAgentText(input.profile.idlePreset),
        interactionPolicyRef: normalizeRuntimeAgentText(input.profile.interactionPolicyRef),
        defaultVoiceReference: normalizeRuntimeAgentPresentationDefaultVoiceReference(input.profile.defaultVoiceReference),
      },
    },
  };
}

export function createHostRuntimeAgentPresentationProfileSurface(
  options: HostRuntimeAgentPresentationProfileSurfaceOptions,
): RuntimeAgentPresentationProfileSurface {
  let protectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

  const resolveSubjectUserId = async (): Promise<string> => {
    const subjectUserId = normalizeRuntimeAgentText(await options.getSubjectUserId());
    if (!subjectUserId) {
      throw new Error('runtime agent presentation profile requires authenticated subject user id');
    }
    return subjectUserId;
  };

  const getProtectedAccess = () => {
    if (protectedAccess) {
      return protectedAccess;
    }
    protectedAccess = createRuntimeProtectedScopeHelper({
      runtime: options.getRuntime(),
      getSubjectUserId: async () => resolveSubjectUserId(),
    });
    return protectedAccess;
  };

  const withRuntimeAgentWrite = <T>(
    operation: (callOptions: RuntimeCallOptions) => Promise<T>,
  ) => (
    options.withScopes
      ? options.withScopes(['runtime.agent.write'], operation)
      : getProtectedAccess().withScopes(['runtime.agent.write'], operation)
  );

  return {
    async setPresentationProfile(agentId, profile) {
      const normalizedAgentId = normalizeRuntimeAgentText(agentId);
      if (!normalizedAgentId) {
        throw new Error('AGENT_ID_REQUIRED');
      }
      const runtime = options.getRuntime();
      const subjectUserId = await resolveSubjectUserId();
      try {
        await withRuntimeAgentWrite((callOptions) => runtime.agent.setPresentationProfile(
          buildSetRuntimeAgentPresentationProfileRequest({
            context: {
              appId: runtime.appId,
              subjectUserId,
            },
            agentId: normalizedAgentId,
            profile,
          }),
          callOptions,
        ));
      } catch (error) {
        throw normalizeRuntimeAgentError(error, 'set_runtime_agent_presentation_profile');
      }
    },
  };
}
