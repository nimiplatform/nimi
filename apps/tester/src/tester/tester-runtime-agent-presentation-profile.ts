import {
  buildSetRuntimeAgentPresentationProfileRequest,
  createHostRuntimeAgentPresentationProfileSurface,
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
  const mutation = request.mutation;
  return {
    backendKind: 'profile' in mutation ? mutation.profile.backendKind : 0,
    localAgentOwner: parseRuntimeLocalAgentIdentity(agentId).ownerUserId,
    defaultVoiceReference: normalizeRuntimeAgentPresentationDefaultVoiceReference(' provider_voice_ref:tester:voice '),
    mutationKind: mutation.oneofKind ?? 'unknown',
  };
}

export function createTesterRuntimeAgentPresentationProfileSurface() {
  return createHostRuntimeAgentPresentationProfileSurface({
    getRuntime: () => ({
      appId: 'dev.nimi.tester',
      auth: {
        registerApp: async () => ({ accepted: true }),
      },
      appAuth: {
        authorizeExternalPrincipal: async () => ({
          tokenId: 'tester-token',
          secret: 'tester-secret',
        }),
      },
      agent: {
        setPresentationProfile: async (request: unknown) => ({ request }),
      },
    }) as never,
    getSubjectUserId: () => 'tester-user',
  });
}

export async function inspectTesterRuntimeAgentPresentationProfileSurface(): Promise<{
  applied: boolean;
  backendKind: string;
}> {
  const surface = createTesterRuntimeAgentPresentationProfileSurface();
  await surface.setPresentationProfile('local-agent:tester-user:tester-agent', {
    backendKind: 'live2d',
    avatarAssetRef: 'asset://tester/live2d-agent',
    defaultVoiceReference: 'provider_voice_ref:tester:voice',
  });
  return {
    applied: true,
    backendKind: 'live2d',
  };
}
