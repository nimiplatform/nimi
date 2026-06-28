import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requireNimiRuntimeVoiceReferenceForLocalTts,
  toNimiRuntimeVoiceReferenceFromInput,
} from './index';

test('voice reference parser accepts prefixed strings and objects', () => {
  assert.deepEqual(
    toNimiRuntimeVoiceReferenceFromInput('provider_voice_ref:alice'),
    { kind: 'provider_voice_ref', providerVoiceRef: 'alice' },
  );
  assert.deepEqual(
    toNimiRuntimeVoiceReferenceFromInput({ kind: 'voice_asset_id', voiceAssetId: 'asset-1' }),
    { kind: 'voice_asset_id', voiceAssetId: 'asset-1' },
  );
});

test('voice reference parser treats default and auto as no explicit voice', () => {
  assert.equal(toNimiRuntimeVoiceReferenceFromInput('default'), undefined);
  assert.equal(toNimiRuntimeVoiceReferenceFromInput({ providerVoiceRef: '  ' }), undefined);
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
    /explicit admitted Voice reference/,
  );
});
