import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeRuntimeAgentPresentationBackendKind,
  normalizeRuntimeAgentPresentationDefaultVoiceReference,
} from '../src/shell/renderer/infra/runtime-agent-presentation-profile';

test('runtime agent presentation profile admits only runtime backend kinds', () => {
  assert.equal(normalizeRuntimeAgentPresentationBackendKind('vrm'), 1);
  assert.equal(normalizeRuntimeAgentPresentationBackendKind('live2d'), 2);
  assert.equal(normalizeRuntimeAgentPresentationBackendKind('unknown' as 'vrm'), null);
});

test('runtime agent presentation profile keeps admitted runtime voice references', () => {
  assert.equal(
    normalizeRuntimeAgentPresentationDefaultVoiceReference('preset_voice_id:alloy'),
    'preset_voice_id:alloy',
  );
  assert.equal(
    normalizeRuntimeAgentPresentationDefaultVoiceReference(' voice_asset_id:voice-asset-1 '),
    'voice_asset_id:voice-asset-1',
  );
  assert.equal(
    normalizeRuntimeAgentPresentationDefaultVoiceReference('provider_voice_ref:openai:verse'),
    'provider_voice_ref:openai:verse',
  );
});

test('runtime agent presentation profile drops UI-only voice URIs before Runtime RPC', () => {
  assert.equal(normalizeRuntimeAgentPresentationDefaultVoiceReference('voice://agent-1/default'), '');
  assert.equal(normalizeRuntimeAgentPresentationDefaultVoiceReference(''), '');
  assert.equal(normalizeRuntimeAgentPresentationDefaultVoiceReference(null), '');
});
