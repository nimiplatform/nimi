import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSourceAndModel } from '../src/runtime/llm-adapter/execution/runtime-ai-bridge';

test('resolveSourceAndModel rejects missing provider', () => {
  assert.throws(
    () => resolveSourceAndModel({
      provider: '',
      model: 'qwen-plus',
    }),
    (error: Error & { reasonCode?: string }) => {
      assert.match(error.message, /provider is required/i);
      return true;
    },
  );
});

test('resolveSourceAndModel rejects missing model', () => {
  assert.throws(
    () => resolveSourceAndModel({
      provider: 'dashscope',
      model: '',
    }),
    (error: Error & { reasonCode?: string }) => {
      assert.match(error.message, /model is required/i);
      return true;
    },
  );
});

test('resolveSourceAndModel preserves explicit token-api provider and prefixes cloud model', () => {
  const resolved = resolveSourceAndModel({
    provider: 'dashscope',
    model: 'qwen-plus',
  });

  assert.equal(resolved.source, 'token-api');
  assert.equal(resolved.modelId, 'cloud/qwen-plus');
  assert.equal(resolved.provider, 'dashscope');
  assert.equal(resolved.fallbackPolicy, 1);
});
