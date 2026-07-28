import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requireNimiRuntimeVoiceReferenceForLocalTts,
  toNimiRuntimeVoiceReferenceFromInput,
} from './index';
import { isNimiError, ReasonCode } from '../../types';

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
    (error) => {
      assert.equal(isNimiError(error), true);
      assert.equal(error.code, 'SDK_GENERATION_PROVIDER_VOICE_REF_FORBIDDEN');
      assert.equal(error.reasonCode, ReasonCode.SDK_AI_INPUT_INVALID);
      assert.equal(error.actionHint, 'bind_runtime_voice_asset');
      return true;
    },
  );
  assert.throws(
    () => toNimiRuntimeVoiceReferenceFromInput('alice'),
    (error) => {
      assert.equal(isNimiError(error), true);
      assert.equal(error.code, 'SDK_GENERATION_VOICE_REFERENCE_KIND_UNSUPPORTED');
      assert.equal(error.reasonCode, ReasonCode.SDK_AI_INPUT_INVALID);
      assert.equal(error.actionHint, 'use_preset_or_voice_asset_reference');
      return true;
    },
  );
  assert.throws(
    () => toNimiRuntimeVoiceReferenceFromInput({ providerVoiceRef: 'alice' }),
    (error) => {
      assert.equal(isNimiError(error), true);
      assert.equal(error.code, 'SDK_GENERATION_PROVIDER_VOICE_REF_FORBIDDEN');
      assert.equal(error.reasonCode, ReasonCode.SDK_AI_INPUT_INVALID);
      assert.equal(error.actionHint, 'bind_runtime_voice_asset');
      return true;
    },
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
    (error) => {
      assert.equal(isNimiError(error), true);
      assert.equal(error.code, 'SDK_GENERATION_LOCAL_TTS_VOICE_REFERENCE_REQUIRED');
      assert.equal(error.reasonCode, ReasonCode.SDK_AI_INPUT_INVALID);
      assert.equal(error.actionHint, 'select_admitted_voice_reference');
      return true;
    },
  );
});
