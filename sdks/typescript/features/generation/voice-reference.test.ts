import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requireNimiRuntimeVoiceReferenceForLocalTts,
  toNimiRuntimeVoiceReferenceFromInput,
} from './index';

test('voice reference parser accepts ordinary public preset and asset references', () => {
  assert.deepEqual(
    toNimiRuntimeVoiceReferenceFromInput('preset_voice_id:alice'),
    { kind: 'preset_voice_id', presetVoiceId: 'alice' },
  );
  assert.deepEqual(
    toNimiRuntimeVoiceReferenceFromInput({ kind: 'voice_asset_id', voiceAssetId: 'asset-1' }),
    { kind: 'voice_asset_id', voiceAssetId: 'asset-1' },
  );
});

test('voice reference parser treats default and blank object refs as no explicit voice', () => {
  assert.equal(toNimiRuntimeVoiceReferenceFromInput('default'), undefined);
  assert.equal(toNimiRuntimeVoiceReferenceFromInput({ providerVoiceRef: '  ' }), undefined);
});

test('voice reference parser rejects provider handles and unprefixed strings on ordinary SDK input', () => {
  assert.throws(
    () => toNimiRuntimeVoiceReferenceFromInput('provider_voice_ref:alice'),
    /provider_voice_ref is not accepted/u,
  );
  assert.throws(
    () => toNimiRuntimeVoiceReferenceFromInput('alice'),
    /preset_voice_id or voice_asset_id/u,
  );
  assert.throws(
    () => toNimiRuntimeVoiceReferenceFromInput({ providerVoiceRef: 'alice' }),
    /provider_voice_ref is not accepted/u,
  );
});

test('local TTS requires an explicit admitted voice reference', () => {
  assert.deepEqual(
    requireNimiRuntimeVoiceReferenceForLocalTts({
      routePolicy: 'local',
      voiceRef: { kind: 'voice_asset_id', voiceAssetId: 'asset-1' },
    }),
    { kind: 'voice_asset_id', voiceAssetId: 'asset-1' },
  );
  assert.throws(
    () => requireNimiRuntimeVoiceReferenceForLocalTts({ routePolicy: 'local', voiceRef: undefined }),
    /explicit preset_voice_id or voice_asset_id/u,
  );
});
