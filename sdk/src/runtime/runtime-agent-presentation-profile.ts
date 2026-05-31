import {
  AgentPresentationBackendKind,
  type SetAgentPresentationProfileRequest,
} from './generated/runtime/v1/agent_service.js';
import { normalizeRuntimeAgentText } from './runtime-agent-inspect-projection.js';

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

export type RuntimeLocalAgentIdentity = {
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
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

export function parseRuntimeLocalAgentIdentity(localAgentRef: unknown): RuntimeLocalAgentIdentity {
  const normalized = normalizeRuntimeAgentText(localAgentRef);
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
  const context = {
    appId,
    subjectUserId,
    ...parseRuntimeLocalAgentIdentity(agentId),
  };
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
