import {
  buildNimiSetRuntimeAgentPresentationProfileRequest,
  createNimiHostRuntimeAgentPresentationProfileSurface,
  normalizeNimiRuntimeAgentPresentationDefaultVoiceReference,
} from '@nimiplatform/sdk/runtime';

export type TesterRuntimeAgentPresentationProfileProjection = {
  backendKind: number;
  localAgentOwner: string;
  defaultVoiceReference: string;
  mutationKind: string;
};

export function createTesterRuntimeAgentPresentationProfileProjection(): TesterRuntimeAgentPresentationProfileProjection {
  const identity = {
    localAgentRef: 'local-agent:tester-opaque-agent',
    ownerUserId: 'tester-user',
    runtimeSourceRef: 'tester-agent',
  };
  const request = buildNimiSetRuntimeAgentPresentationProfileRequest({
    context: { appId: 'tester', subjectUserId: 'tester-user' },
    identity,
    profile: {
      backendKind: 'live2d',
      avatarAssetRef: 'asset://tester/live2d-agent',
      defaultVoiceReference: ' voice_asset_id:tester-voice-asset ',
    },
  });
  const mutation = request.mutation;
  return {
    backendKind: 'profile' in mutation ? mutation.profile.backendKind : 0,
    localAgentOwner: identity.ownerUserId,
    defaultVoiceReference: normalizeNimiRuntimeAgentPresentationDefaultVoiceReference(' voice_asset_id:tester-voice-asset '),
    mutationKind: mutation.oneofKind ?? 'unknown',
  };
}

export function createTesterRuntimeAgentPresentationProfileSurface() {
  return createNimiHostRuntimeAgentPresentationProfileSurface({
    getRuntime: () => ({
      appId: 'nimi.tester',
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
        setAgentPresentationProfile: async (request: unknown) => ({ request }),
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
  await surface.setPresentationProfile({
    localAgentRef: 'local-agent:tester-opaque-agent',
    ownerUserId: 'tester-user',
    runtimeSourceRef: 'tester-agent',
  }, {
    backendKind: 'live2d',
    avatarAssetRef: 'asset://tester/live2d-agent',
    defaultVoiceReference: 'voice_asset_id:tester-voice-asset',
  });
  return {
    applied: true,
    backendKind: 'live2d',
  };
}
