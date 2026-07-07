import {
  AgentPresentationBackendKind,
  type RuntimeTypedCallOptions,
  type SetAgentPresentationProfileRequest,
  type SetAgentPresentationProfileResponse,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import {
  buildRuntimeAgentRequestContext,
  projectRuntimeLocalAgentIdentity,
  type RuntimeLocalAgentIdentityInput,
} from './agent-local-identity';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAppAuthClient,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { normalizeNimiRuntimeAgentText } from './runtime-agent-values';

export interface NimiRuntimeAgentPresentationProfileInput {
  readonly backendKind?: unknown;
  readonly avatarAssetRef?: unknown;
  readonly expressionProfileRef?: unknown;
  readonly idlePreset?: unknown;
  readonly interactionPolicyRef?: unknown;
  readonly defaultVoiceReference?: unknown;
  readonly avatarAutoplay?: unknown;
}

export interface NimiRuntimeAgentPresentationProfileContext {
  readonly appId: string;
  readonly subjectUserId: string;
}

export interface NimiRuntimeAgentPresentationProfileSurface {
  setPresentationProfile(input: RuntimeLocalAgentIdentityInput, profile: NimiRuntimeAgentPresentationProfileInput | null): Promise<void>;
}

export interface NimiHostRuntimeAgentPresentationProfileClient {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly appAuth: NimiRuntimeAgentAppAuthClient;
  readonly agent: {
    setAgentPresentationProfile(
      request: SetAgentPresentationProfileRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<SetAgentPresentationProfileResponse>;
  };
}

export interface NimiHostRuntimeAgentPresentationProfileSurfaceOptions {
  readonly getRuntime: () => NimiHostRuntimeAgentPresentationProfileClient;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

const RUNTIME_AGENT_PRESENTATION_VOICE_REFERENCE_PREFIXES = [
  'preset_voice_id:',
  'voice_asset_id:',
];

export function normalizeNimiRuntimeAgentPresentationBackendKind(
  value: unknown,
): AgentPresentationBackendKind | null {
  switch (normalizeNimiRuntimeAgentText(value).toLowerCase()) {
    case 'vrm':
      return AgentPresentationBackendKind.VRM;
    case 'live2d':
      return AgentPresentationBackendKind.LIVE2D;
    case 'sprite2d':
      return AgentPresentationBackendKind.SPRITE2D;
    case 'canvas2d':
      return AgentPresentationBackendKind.CANVAS2D;
    case 'video':
      return AgentPresentationBackendKind.VIDEO;
    default:
      return null;
  }
}

export function normalizeNimiRuntimeAgentPresentationDefaultVoiceReference(value: unknown): string {
  const normalized = normalizeNimiRuntimeAgentText(value);
  if (!normalized) {
    return '';
  }
  if (RUNTIME_AGENT_PRESENTATION_VOICE_REFERENCE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return normalized;
  }
  presentationError(
    'Runtime Agent presentation profile voice reference must use preset_voice_id or voice_asset_id.',
    'SDK_RUNTIME_AGENT_PRESENTATION_VOICE_REFERENCE_INVALID',
    'provide_runtime_owned_voice_reference',
  );
}

function presentationError(message: string, reasonCode: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
  });
}

export function buildNimiSetRuntimeAgentPresentationProfileRequest(input: {
  readonly context: NimiRuntimeAgentPresentationProfileContext;
  readonly identity: RuntimeLocalAgentIdentityInput;
  readonly profile: NimiRuntimeAgentPresentationProfileInput | null | undefined;
}): SetAgentPresentationProfileRequest {
  const identity = projectRuntimeLocalAgentIdentity(input.identity);
  const agentId = identity.localAgentRef;
  const appId = normalizeNimiRuntimeAgentText(input.context.appId);
  const subjectUserId = normalizeNimiRuntimeAgentText(input.context.subjectUserId);
  if (!agentId) {
    presentationError('Runtime Agent presentation profile requires agent id.', 'SDK_RUNTIME_AGENT_ID_REQUIRED', 'provide_runtime_agent_id');
  }
  if (!appId || !subjectUserId) {
    presentationError(
      'Runtime Agent presentation profile requires app id and subject user id.',
      'SDK_RUNTIME_AGENT_PRESENTATION_CONTEXT_REQUIRED',
      'provide_runtime_agent_context',
    );
  }
  const context = buildRuntimeAgentRequestContext({
    runtimeAppId: appId,
    subjectUserId,
    ownerUserId: identity.ownerUserId,
    runtimeSourceRef: identity.runtimeSourceRef,
    localAgentRef: identity.localAgentRef,
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
  const backendKind = normalizeNimiRuntimeAgentPresentationBackendKind(input.profile.backendKind);
  const avatarAssetRef = normalizeNimiRuntimeAgentText(input.profile.avatarAssetRef);
  if (!backendKind || !avatarAssetRef) {
    presentationError(
      'Runtime Agent presentation profile requires backend kind and avatar asset ref.',
      'SDK_RUNTIME_AGENT_PRESENTATION_PROFILE_INVALID',
      'provide_runtime_agent_presentation_profile',
    );
  }
  return {
    context,
    agentId,
    mutation: {
      oneofKind: 'profile',
      profile: {
        backendKind,
        avatarAssetRef,
        expressionProfileRef: normalizeNimiRuntimeAgentText(input.profile.expressionProfileRef),
        idlePreset: normalizeNimiRuntimeAgentText(input.profile.idlePreset),
        interactionPolicyRef: normalizeNimiRuntimeAgentText(input.profile.interactionPolicyRef),
        defaultVoiceReference: normalizeNimiRuntimeAgentPresentationDefaultVoiceReference(input.profile.defaultVoiceReference),
        avatarAutoplay: input.profile.avatarAutoplay === true,
      },
    },
  };
}

export function createNimiHostRuntimeAgentPresentationProfileSurface(
  options: NimiHostRuntimeAgentPresentationProfileSurfaceOptions,
): NimiRuntimeAgentPresentationProfileSurface {
  return {
    async setPresentationProfile(identity, profile) {
      const runtime = options.getRuntime();
      const subjectUserId = await resolveNimiRuntimeAgentSubjectUserId(
        options.getSubjectUserId,
        'Runtime Agent presentation profile requires authenticated subject user id.',
      );
      await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, ['runtime.agent.write'], (callOptions) => runtime.agent.setAgentPresentationProfile(
        buildNimiSetRuntimeAgentPresentationProfileRequest({
          context: { appId: runtime.appId, subjectUserId },
          identity,
          profile,
        }),
        callOptions,
      ));
    },
  };
}
