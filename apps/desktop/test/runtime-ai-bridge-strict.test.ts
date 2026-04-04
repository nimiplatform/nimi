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

test('resolveSourceAndModel preserves explicit cloud provider and prefixes cloud model', () => {
  const resolved = resolveSourceAndModel({
    provider: 'dashscope',
    model: 'qwen-plus',
  });

  assert.equal(resolved.source, 'cloud');
  assert.equal(resolved.modelId, 'cloud/qwen-plus');
  assert.equal(resolved.provider, 'dashscope');
  assert.equal(resolved.routePolicy, 2);
});

test('resolveSourceAndModel prefixes llama selectors for local routes', () => {
  const resolved = resolveSourceAndModel({
    provider: 'llama',
    model: 'qwen3-chat',
    localProviderEndpoint: 'http://127.0.0.1:1234/v1',
  });

  assert.equal(resolved.source, 'local');
  assert.equal(resolved.modelId, 'llama/qwen3-chat');
});

test('resolveSourceAndModel keeps generic local selector when provider is legacy nexa', () => {
  const resolved = resolveSourceAndModel({
    provider: 'nexa',
    model: 'qwen-rerank',
    localProviderEndpoint: 'http://127.0.0.1:18181/v1',
  });

  assert.equal(resolved.source, 'local');
  assert.equal(resolved.modelId, 'local/qwen-rerank');
});

test('resolveSourceAndModel prefixes media selectors for local routes', () => {
  const resolved = resolveSourceAndModel({
    provider: 'media',
    model: 'flux.1-schnell',
    localProviderEndpoint: 'http://127.0.0.1:8321/v1',
  });

  assert.equal(resolved.source, 'local');
  assert.equal(resolved.modelId, 'media/flux.1-schnell');
});
