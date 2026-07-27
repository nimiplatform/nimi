import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeNimiRuntimeAgentPresentationBackendKind, normalizeNimiRuntimeAgentPresentationDefaultVoiceReference } from '@nimiplatform/sdk/runtime';
import { AgentPresentationBackendKind } from '@nimiplatform/sdk/runtime/wire-types';

test('runtime agent presentation profile admits only runtime backend kinds', () => {
  assert.equal(normalizeNimiRuntimeAgentPresentationBackendKind('vrm'), AgentPresentationBackendKind.VRM);
  assert.equal(normalizeNimiRuntimeAgentPresentationBackendKind('live2d'), AgentPresentationBackendKind.LIVE2D);
  assert.equal(normalizeNimiRuntimeAgentPresentationBackendKind('sprite2d'), AgentPresentationBackendKind.SPRITE2D);
  assert.equal(normalizeNimiRuntimeAgentPresentationBackendKind('canvas2d'), AgentPresentationBackendKind.CANVAS2D);
  assert.equal(normalizeNimiRuntimeAgentPresentationBackendKind('video'), AgentPresentationBackendKind.VIDEO);
  assert.equal(normalizeNimiRuntimeAgentPresentationBackendKind('unknown' as 'vrm'), null);
});

test('runtime agent presentation profile keeps admitted runtime voice references', () => {
  assert.equal(
    normalizeNimiRuntimeAgentPresentationDefaultVoiceReference('preset_voice_id:alloy'),
    'preset_voice_id:alloy',
  );
  assert.equal(
    normalizeNimiRuntimeAgentPresentationDefaultVoiceReference('voice_asset_id:voice-asset-1'),
    'voice_asset_id:voice-asset-1',
  );
});

test('runtime agent presentation profile rejects non-runtime voice references before Runtime RPC', () => {
  assert.throws(
    () => normalizeNimiRuntimeAgentPresentationDefaultVoiceReference('provider_voice_ref:openai:verse'),
    /preset_voice_id or voice_asset_id/,
  );
  assert.throws(
    () => normalizeNimiRuntimeAgentPresentationDefaultVoiceReference('voice://agent-1/default'),
    /preset_voice_id or voice_asset_id/,
  );
  assert.throws(
    () => normalizeNimiRuntimeAgentPresentationDefaultVoiceReference(' voice_asset_id:voice-asset-1 '),
    /preset_voice_id or voice_asset_id/,
  );
  assert.throws(
    () => normalizeNimiRuntimeAgentPresentationDefaultVoiceReference(null),
    /preset_voice_id or voice_asset_id/,
  );
  assert.equal(normalizeNimiRuntimeAgentPresentationDefaultVoiceReference(''), '');
  assert.equal(normalizeNimiRuntimeAgentPresentationDefaultVoiceReference(undefined), '');
});
