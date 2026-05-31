import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentPresentationBackendKind,
  buildSetRuntimeAgentPresentationProfileRequest,
  normalizeRuntimeAgentPresentationBackendKind,
  normalizeRuntimeAgentPresentationDefaultVoiceReference,
  parseRuntimeLocalAgentIdentity,
} from '../../src/runtime/index.js';

test('runtime agent presentation profile maps admitted app backend kinds', () => {
  assert.equal(normalizeRuntimeAgentPresentationBackendKind('vrm'), AgentPresentationBackendKind.VRM);
  assert.equal(normalizeRuntimeAgentPresentationBackendKind(' live2d '), AgentPresentationBackendKind.LIVE2D);
  assert.equal(normalizeRuntimeAgentPresentationBackendKind('unknown'), null);
});

test('runtime agent presentation profile filters voice references before Runtime RPC', () => {
  assert.equal(normalizeRuntimeAgentPresentationDefaultVoiceReference('preset_voice_id:alloy'), 'preset_voice_id:alloy');
  assert.equal(normalizeRuntimeAgentPresentationDefaultVoiceReference(' voice_asset_id:voice-asset-1 '), 'voice_asset_id:voice-asset-1');
  assert.equal(normalizeRuntimeAgentPresentationDefaultVoiceReference('provider_voice_ref:openai:verse'), 'provider_voice_ref:openai:verse');
  assert.equal(normalizeRuntimeAgentPresentationDefaultVoiceReference('voice://agent-1/default'), '');
  assert.equal(normalizeRuntimeAgentPresentationDefaultVoiceReference(null), '');
});

test('runtime agent presentation profile builds set and clear requests', () => {
  assert.deepEqual(parseRuntimeLocalAgentIdentity('local-agent:user-1:realm-agent-1'), {
    ownerUserId: 'user-1',
    realmAgentId: 'realm-agent-1',
    localAgentRef: 'local-agent:user-1:realm-agent-1',
  });
  assert.deepEqual(buildSetRuntimeAgentPresentationProfileRequest({
    context: { appId: 'desktop', subjectUserId: 'user-1' },
    agentId: 'local-agent:user-1:realm-agent-1',
    profile: {
      backendKind: 'vrm',
      avatarAssetRef: 'asset://avatar/agent-1',
      expressionProfileRef: 'friendly',
      idlePreset: 'soft-idle',
      interactionPolicyRef: 'default',
      defaultVoiceReference: 'voice://agent-1/default',
    },
  }), {
    context: {
      appId: 'desktop',
      subjectUserId: 'user-1',
      ownerUserId: 'user-1',
      realmAgentId: 'realm-agent-1',
      localAgentRef: 'local-agent:user-1:realm-agent-1',
    },
    agentId: 'local-agent:user-1:realm-agent-1',
    mutation: {
      oneofKind: 'profile',
      profile: {
        backendKind: AgentPresentationBackendKind.VRM,
        avatarAssetRef: 'asset://avatar/agent-1',
        expressionProfileRef: 'friendly',
        idlePreset: 'soft-idle',
        interactionPolicyRef: 'default',
        defaultVoiceReference: '',
      },
    },
  });
  assert.equal(buildSetRuntimeAgentPresentationProfileRequest({
    context: { appId: 'desktop', subjectUserId: 'user-1' },
    agentId: 'local-agent:user-1:realm-agent-1',
    profile: null,
  }).mutation.oneofKind, 'clear');
});

test('runtime agent presentation profile request projection fails closed', () => {
  assert.throws(() => parseRuntimeLocalAgentIdentity('realm-agent-1'), /localAgentRef/);
  assert.throws(() => buildSetRuntimeAgentPresentationProfileRequest({
    context: { appId: 'desktop', subjectUserId: 'user-1' },
    agentId: 'local-agent:user-1:realm-agent-1',
    profile: { backendKind: 'unknown', avatarAssetRef: 'asset://avatar/agent-1' },
  }), /AGENT_PRESENTATION_PROFILE_INVALID/);
});
