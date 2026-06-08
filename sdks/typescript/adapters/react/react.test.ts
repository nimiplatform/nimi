import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiReactConversationStore,
  NIMI_REACT_ADAPTER_MANIFEST,
  NIMI_REACT_UNSUPPORTED_FEATURE_CODE,
  NimiReactUnsupportedFeatureError,
  useNimiReactConversation,
} from './index';

test('react adapter projects conversation feature events to headless state', () => {
  const state = createNimiReactConversationStore([
    { type: 'conversation.started' },
    { type: 'conversation.text_delta', text: 'hel' },
    { type: 'conversation.text_delta', text: 'lo' },
    { type: 'conversation.tool_call', id: 'call_1', name: 'lookup' },
    { type: 'conversation.completed', finishReason: 'stop' },
  ]);

  assert.equal(state.status, 'completed');
  assert.equal(state.text, 'hello');
  assert.deepEqual(state.toolCalls, [{ id: 'call_1', name: 'lookup' }]);
});

test('react adapter fails closed for hooks in base source root', () => {
  assert.throws(
    () => useNimiReactConversation(),
    (error: unknown) => {
      assert.ok(error instanceof NimiReactUnsupportedFeatureError);
      assert.equal(error.code, NIMI_REACT_UNSUPPORTED_FEATURE_CODE);
      assert.equal(error.feature, 'hooks');
      return true;
    },
  );
});

test('react manifest is explicit about headless-only support', () => {
  assert.equal(NIMI_REACT_ADAPTER_MANIFEST.capabilities['conversation.state'].support, 'supported');
  assert.equal(NIMI_REACT_ADAPTER_MANIFEST.capabilities.hooks.support, 'unsupported');
  assert.equal(NIMI_REACT_ADAPTER_MANIFEST.capabilities.renderer.support, 'unsupported');
});
