import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_NEXT_ADAPTER_MANIFEST,
  NIMI_NEXT_UNSUPPORTED_FEATURE_CODE,
  NimiNextUnsupportedFeatureError,
  throwUnsupportedNextFeature,
} from './index';
import * as nextAdapter from './index';

test('next adapter does not expose a stable OpenAI-compatible chat completion route', () => {
  assert.equal('createNimiNextChatCompletionRoute' in nextAdapter, false);
  assert.equal(NIMI_NEXT_ADAPTER_MANIFEST.capabilities['route.chatCompletions.json'].support, 'unsupported');
});

test('next adapter route capabilities fail closed as unsupported features', () => {
  assert.throws(
    () => throwUnsupportedNextFeature('route.chatCompletions.json'),
    (error: unknown) => {
      assert.ok(error instanceof NimiNextUnsupportedFeatureError);
      assert.equal(error.code, NIMI_NEXT_UNSUPPORTED_FEATURE_CODE);
      assert.equal(error.feature, 'route.chatCompletions.json');
      return true;
    },
  );
});

test('next manifest does not claim route, middleware, or server action parity', () => {
  assert.equal(NIMI_NEXT_ADAPTER_MANIFEST.capabilities['route.chatCompletions.json'].support, 'unsupported');
  assert.equal(NIMI_NEXT_ADAPTER_MANIFEST.capabilities['route.chatCompletions.stream'].support, 'unsupported');
  assert.equal(NIMI_NEXT_ADAPTER_MANIFEST.capabilities.middleware.support, 'unsupported');
  assert.equal(NIMI_NEXT_ADAPTER_MANIFEST.capabilities.serverActions.support, 'unsupported');
});
