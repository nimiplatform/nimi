import {
  buildSetRuntimeAgentPresentationProfileRequest,
  normalizeRuntimeAgentPresentationDefaultVoiceReference,
  parseRuntimeLocalAgentIdentity,
} from '@nimiplatform/sdk/runtime';

export type TesterRuntimeAgentPresentationProfileProjection = {
  backendKind: number;
  localAgentOwner: string;
  defaultVoiceReference: string;
  mutationKind: string;
};

export function createTesterRuntimeAgentPresentationProfileProjection(): TesterRuntimeAgentPresentationProfileProjection {
  const agentId = 'local-agent:tester-user:tester-agent';
  const request = buildSetRuntimeAgentPresentationProfileRequest({
    context: { appId: 'tester', subjectUserId: 'tester-user' },
    agentId,
    profile: {
      backendKind: 'live2d',
      avatarAssetRef: 'asset://tester/live2d-agent',
      defaultVoiceReference: ' provider_voice_ref:tester:voice ',
    },
  });
  return {
    backendKind: request.mutation.oneofKind === 'profile' ? request.mutation.profile.backendKind : 0,
    localAgentOwner: parseRuntimeLocalAgentIdentity(agentId).ownerUserId,
    defaultVoiceReference: normalizeRuntimeAgentPresentationDefaultVoiceReference(' provider_voice_ref:tester:voice '),
    mutationKind: request.mutation.oneofKind ?? 'unknown',
  };
}
