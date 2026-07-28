import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNimiSetRuntimeAgentPresentationProfileRequest,
  createNimiHostRuntimeAgentPresentationProfileSurface,
  projectNimiRuntimeAgentInspectSnapshot,
  readNimiRuntimeAgentPresentationProfile,
} from './index';
import {
  AgentLifecycleStatus,
  AgentPresentationBackendKind,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import type { RuntimeLocalAgentIdentityInput } from './agent-local-identity';
import type { NimiRuntimeAgentInspectSurface } from './runtime-agent-inspect-types';
import type {
  NimiRuntimeAgentPresentationProfileInput,
  NimiRuntimeAgentPresentationProfileMutationResult,
  NimiRuntimeAgentPresentationProfileSurface,
} from './runtime-agent-presentation';

const IDENTITY = {
  ownerUserId: 'user-1',
  runtimeSourceRef: 'runtime-source-1',
  localAgentRef: 'local-agent:user-1-runtime-source-1',
} as const;

const CONTEXT = {
  appId: 'sdk.test',
  subjectUserId: 'user-1',
} as const;

type RuntimeAgentPresentationTestSurface =
  Pick<NimiRuntimeAgentInspectSurface, 'getPresentationProfile'>
  & NimiRuntimeAgentPresentationProfileSurface;

async function setPresentationProfileAtCurrentRevision(input: {
  readonly presentation: RuntimeAgentPresentationTestSurface;
  readonly identity: RuntimeLocalAgentIdentityInput;
  readonly profile: NimiRuntimeAgentPresentationProfileInput;
}): Promise<NimiRuntimeAgentPresentationProfileMutationResult> {
  const current = await input.presentation.getPresentationProfile(input.identity);
  if (current.committedRevision === null) {
    throw new Error('presentation mutation requires a committed Runtime Agent revision');
  }
  return input.presentation.setPresentationProfile(
    input.identity,
    input.profile,
    current.committedRevision,
  );
}

function buildProfileRequest(overrides: Record<string, unknown> = {}) {
  return buildNimiSetRuntimeAgentPresentationProfileRequest({
    context: CONTEXT,
    identity: IDENTITY,
    expectedRevision: '7',
    profile: {
      backendKind: 'vrm',
      avatarAssetRef: 'agent_avatar:account-1/agent-1/avatar.vrm',
      avatarAutoplay: false,
      ...overrides,
    },
  });
}

test('presentation request requires and preserves the exact expected revision', () => {
  const request = buildProfileRequest();
  assert.equal(request.expectedRevision, '7');

  assert.throws(() => buildNimiSetRuntimeAgentPresentationProfileRequest({
    context: CONTEXT,
    identity: IDENTITY,
    profile: {
      backendKind: 'vrm',
      avatarAssetRef: 'avatar-1',
    },
  } as never), /expected revision/iu);

  for (const expectedRevision of ['', '-1', '1.0', '01', ' 1', '18446744073709551616']) {
    assert.throws(() => buildNimiSetRuntimeAgentPresentationProfileRequest({
      context: CONTEXT,
      identity: IDENTITY,
      expectedRevision,
      profile: {
        backendKind: 'vrm',
        avatarAssetRef: 'avatar-1',
      },
    }), /expected revision/iu, expectedRevision);
  }
  assert.equal(buildNimiSetRuntimeAgentPresentationProfileRequest({
    context: CONTEXT,
    identity: IDENTITY,
    expectedRevision: '18446744073709551615',
    profile: {
      backendKind: 'vrm',
      avatarAssetRef: 'avatar-1',
    },
  }).expectedRevision, '18446744073709551615');
});

test('presentation request preserves explicit false and empty-string patch clears', () => {
  const request = buildNimiSetRuntimeAgentPresentationProfileRequest({
    context: CONTEXT,
    identity: IDENTITY,
    expectedRevision: '0',
    patch: {
      avatarAssetRef: '',
      defaultVoiceReference: '',
      avatarAutoplay: false,
    },
  });

  assert.equal(request.expectedRevision, '0');
  assert.equal(request.mutation.oneofKind, 'patch');
  assert.equal(request.mutation.patch.avatarAssetRef, '');
  assert.equal(request.mutation.patch.defaultVoiceReference, '');
  assert.equal(request.mutation.patch.avatarAutoplay, false);
});

test('presentation request rejects non-boolean avatar autoplay instead of coercing it', () => {
  for (const avatarAutoplay of ['false', 0, 1, null, {}, []]) {
    assert.throws(() => buildProfileRequest({ avatarAutoplay }), /avatar autoplay.*boolean/iu);
  }
});

test('presentation request mirrors Runtime opaque-ref admission', () => {
  for (const avatarAssetRef of [
    '/tmp/avatar.vrm',
    'C:\\avatars\\avatar.vrm',
    '\\\\server\\share\\avatar.vrm',
    'file:///tmp/avatar.vrm',
    'data:model/gltf-binary;base64,AAAA',
    'http://example.test/avatar.vrm',
    'https://example.test/avatar.vrm',
    'avatar:../avatar.vrm',
    'avatar:%2e%2e/avatar.vrm',
    'avatar:%5cserver/avatar.vrm',
    'avatar:bad%2',
    'profile_media_url:http://example.test/avatar.png',
    'profile_media_url:https:example.test/avatar.png',
    'profile_media_url:https:/example.test/avatar.png',
    'profile_media_url:https:///example.test/avatar.png',
    'profile_media_url:https://user@example.test/avatar.png',
    'profile_media_url:https://%65xample.com/avatar.png',
    'profile_media_url:https://user%40example.com/avatar.png',
    'profile_media_url:https://example.com%2fevil/avatar.png',
    'profile_media_url:https://example.com:bad/avatar.png',
    'profile_media_url:https://[::1/avatar.png',
    'profile_media_url:https://[::1]bad/avatar.png',
    'profile_media_url:https://[::1]:bad/avatar.png',
    'profile_media_url:https://[hello]/avatar.png',
    'profile_media_url:https://[v1.fe]/avatar.png',
    'profile_media_url:https://[2001:db8:::1]/avatar.png',
    'profile_media_url:https://[2001:db8::gg]/avatar.png',
    'profile_media_url:https://[2001:db8:1]/avatar.png',
    'profile_media_url:https://[::ffff:192.0.2.999]/avatar.png',
    'profile_media_url:https://[::ffff:192.0.002.1]/avatar.png',
    'profile_media_url:https://[fe80::1%25en%2F0]/avatar.png',
    'profile_media_url:https://[fe80::1%25en%3F0]/avatar.png',
    'profile_media_url:https://[fe80::1%25en%230]/avatar.png',
    'profile_media_url:https://[fe80::1%25en%400]/avatar.png',
    'profile_media_url:https://[fe80::1%25en%200]/avatar.png',
    'profile_media_url:https://[fe80::1%25en%5C0]/avatar.png',
    `avatar:line${String.fromCharCode(0)}break`,
    `avatar:${'a'.repeat(2049)}`,
  ]) {
    assert.throws(() => buildProfileRequest({ avatarAssetRef }), /opaque ref/iu, avatarAssetRef);
  }

  assert.doesNotThrow(() => buildProfileRequest({ avatarAssetRef: 'avatar-1' }));
  assert.doesNotThrow(() => buildProfileRequest({
    avatarAssetRef: 'profile_media_url:https://cdn.nimi.test/avatar.png',
  }));
  assert.doesNotThrow(() => buildProfileRequest({
    avatarAssetRef: 'profile_media_url:https://example.com:99999/avatar.png',
  }));
  assert.doesNotThrow(() => buildProfileRequest({
    avatarAssetRef: 'profile_media_url:https://[2001:db8::1]/avatar.png',
  }));
  assert.doesNotThrow(() => buildProfileRequest({
    avatarAssetRef: 'profile_media_url:https://[::ffff:192.0.2.128]/avatar.png',
  }));
  assert.doesNotThrow(() => buildProfileRequest({
    avatarAssetRef: 'profile_media_url:https://[fe80::1%25en0]:443/avatar.png',
  }));
  assert.doesNotThrow(() => buildProfileRequest({
    avatarAssetRef: 'profile_media_url:https://[fe80::1%25en%410]/avatar.png',
  }));
  assert.doesNotThrow(() => buildProfileRequest({
    avatarAssetRef: 'profile_media_url:https://[fe80::1%25en%220]/avatar.png',
  }));
  assert.doesNotThrow(() => buildProfileRequest({
    avatarAssetRef: 'profile_media_url:https://[fe80::1%25en%250]/avatar.png',
  }));
});

test('presentation request admits only Runtime-owned voice reference kinds with non-empty suffixes', () => {
  for (const defaultVoiceReference of [
    'provider_voice_ref:voice-1',
    'preset_voice_id:',
    'voice_asset_id:   ',
    ' preset_voice_id:voice-1',
    'preset_voice_id:voice-1 ',
  ]) {
    assert.throws(() => buildProfileRequest({ defaultVoiceReference }), /voice reference/iu);
  }

  assert.doesNotThrow(() => buildProfileRequest({ defaultVoiceReference: 'preset_voice_id:voice-1' }));
  assert.doesNotThrow(() => buildProfileRequest({ defaultVoiceReference: 'voice_asset_id:voice-1' }));
});

test('presentation projection reads typed LocalAgentRecord fields and committed revision', () => {
  const agent = {
    lifecycleStatus: AgentLifecycleStatus.ACTIVE,
    presentationProfileRevision: '7',
    presentationProfile: {
      backendKind: AgentPresentationBackendKind.VRM,
      avatarAssetRef: 'agent_avatar:account-1/agent-1/avatar.vrm',
      expressionProfileRef: '',
      idlePreset: '',
      interactionPolicyRef: '',
      defaultVoiceReference: 'preset_voice_id:voice-1',
      avatarAutoplay: false,
      backgroundAssetRef: 'agent_background:account-1/agent-1/background.png',
      revision: '7',
    },
  };

  assert.deepEqual(readNimiRuntimeAgentPresentationProfile(agent), {
    backendKind: 'vrm',
    avatarAssetRef: 'agent_avatar:account-1/agent-1/avatar.vrm',
    expressionProfileRef: null,
    idlePreset: null,
    interactionPolicyRef: null,
    defaultVoiceReference: 'preset_voice_id:voice-1',
    avatarAutoplay: false,
    backgroundAssetRef: 'agent_background:account-1/agent-1/background.png',
  });

  const snapshot = projectNimiRuntimeAgentInspectSnapshot({ agent });
  assert.equal(snapshot.presentationProfileRevision, '7');
  assert.equal(snapshot.presentationProfile?.avatarAssetRef, 'agent_avatar:account-1/agent-1/avatar.vrm');
});

test('presentation projection rejects metadata-owned and invalid persisted profiles', () => {
  assert.equal(readNimiRuntimeAgentPresentationProfile({
    metadata: {
      fields: {
        presentationProfile: {
          kind: {
            oneofKind: 'structValue',
            structValue: { fields: {} },
          },
        },
      },
    },
  }), null);

  const validProfile = {
    backendKind: AgentPresentationBackendKind.VRM,
    avatarAssetRef: 'avatar-1',
    expressionProfileRef: '',
    idlePreset: '',
    interactionPolicyRef: '',
    defaultVoiceReference: '',
    avatarAutoplay: false,
    backgroundAssetRef: '',
    revision: '4',
  };
  for (const agent of [
    { presentationProfileRevision: '3', presentationProfile: validProfile },
    { presentationProfileRevision: '4', presentationProfile: { ...validProfile, avatarAssetRef: '/tmp/avatar.vrm' } },
    { presentationProfileRevision: '4', presentationProfile: { ...validProfile, defaultVoiceReference: 'provider_voice_ref:voice-1' } },
    { presentationProfileRevision: '4', presentationProfile: { ...validProfile, avatarAutoplay: 'false' } },
    { presentationProfileRevision: '4', presentationProfile: { ...validProfile, backendKind: 999 } },
    { presentationProfileRevision: '4', presentationProfile: { ...validProfile, backendKind: '1' } },
    { presentationProfileRevision: '4', presentationProfile: { ...validProfile, backendKind: true } },
  ]) {
    assert.equal(readNimiRuntimeAgentPresentationProfile(agent), null);
  }
});

test('presentation mutation reads CAS revision through the narrow capability', async () => {
  const calls: Array<{ readonly method: string; readonly expectedRevision?: string }> = [];
  const presentation: RuntimeAgentPresentationTestSurface = {
    async getPresentationProfile() {
      calls.push({ method: 'get' });
      return { profile: null, committedRevision: '11' };
    },
    async setPresentationProfile(_identity, _profile, expectedRevision) {
      calls.push({ method: 'set', expectedRevision });
      return { profile: null, committedRevision: '12' };
    },
    async patchPresentationProfile() {
      throw new Error('unexpected patch');
    },
  };

  const result = await setPresentationProfileAtCurrentRevision({
    presentation,
    identity: IDENTITY,
    profile: {
      backendKind: 'vrm',
      avatarAssetRef: 'runtime-presentation-avatar:sdk-live-voice-stream-fixture',
      expressionProfileRef: 'runtime-expression-profile:sdk-live-calm',
      idlePreset: 'runtime-idle-preset:idle-soft',
      interactionPolicyRef: 'runtime-interaction-policy:sdk-live-ambient',
      defaultVoiceReference: 'preset_voice_id:voice-1',
      avatarAutoplay: true,
    },
  });

  assert.deepEqual(calls, [{ method: 'get' }, { method: 'set', expectedRevision: '11' }]);
  assert.equal(result.committedRevision, '12');
});

test('presentation projection admits a valid profile without an avatar asset', () => {
  assert.deepEqual(readNimiRuntimeAgentPresentationProfile({
    presentationProfileRevision: '2',
    presentationProfile: {
      backendKind: AgentPresentationBackendKind.UNSPECIFIED,
      avatarAssetRef: '',
      expressionProfileRef: '',
      idlePreset: '',
      interactionPolicyRef: '',
      defaultVoiceReference: 'preset_voice_id:voice-1',
      avatarAutoplay: true,
      backgroundAssetRef: 'background-1',
      revision: '2',
    },
  }), {
    backendKind: null,
    avatarAssetRef: null,
    expressionProfileRef: null,
    idlePreset: null,
    interactionPolicyRef: null,
    defaultVoiceReference: 'preset_voice_id:voice-1',
    avatarAutoplay: true,
    backgroundAssetRef: 'background-1',
  });

  for (const backendKind of ['0', false]) {
    assert.equal(readNimiRuntimeAgentPresentationProfile({
      presentationProfileRevision: '2',
      presentationProfile: {
        backendKind,
        avatarAssetRef: '',
        expressionProfileRef: '',
        idlePreset: '',
        interactionPolicyRef: '',
        defaultVoiceReference: 'preset_voice_id:voice-1',
        avatarAutoplay: false,
        backgroundAssetRef: '',
        revision: '2',
      },
    }), null);
  }
});

test('presentation surface returns Runtime committed revision without retrying', async () => {
  const requests: Array<Record<string, unknown>> = [];
  let omitProfile = false;
  const runtime = {
    appId: 'sdk.test',
    auth: {
      async registerApp() {
        return { appInstanceId: 'sdk.test.presentation', accepted: true, reasonCode: 0 };
      },
    },
    agent: {
      async setAgentPresentationProfile(request: Record<string, unknown>, _options?: RuntimeTypedCallOptions) {
        requests.push(request);
        if (omitProfile) {
          return { committedRevision: '8' };
        }
        return {
          committedRevision: '8',
          profile: {
            backendKind: AgentPresentationBackendKind.VRM,
            avatarAssetRef: 'avatar-1',
            expressionProfileRef: '',
            idlePreset: '',
            interactionPolicyRef: '',
            defaultVoiceReference: '',
            avatarAutoplay: false,
            backgroundAssetRef: '',
            revision: '8',
          },
        };
      },
    },
  };
  const surface = createNimiHostRuntimeAgentPresentationProfileSurface({
    getRuntime: () => runtime,
    getSubjectUserId: () => 'user-1',
    withScopes: async (scopes, operation) => operation({
      metadata: { scopes: scopes.join(' ') },
    }),
  });

  const result = await surface.setPresentationProfile(IDENTITY, {
    backendKind: 'vrm',
    avatarAssetRef: 'avatar-1',
  }, '7');

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.expectedRevision, '7');
  assert.equal(result.committedRevision, '8');
  assert.equal(result.profile?.avatarAssetRef, 'avatar-1');

  omitProfile = true;
  await assert.rejects(() => surface.setPresentationProfile(IDENTITY, {
    backendKind: 'vrm',
    avatarAssetRef: 'avatar-1',
  }, '7'), /missing.*committed profile/iu);
});
