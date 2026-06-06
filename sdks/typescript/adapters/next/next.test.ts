import assert from 'node:assert/strict';
import test from 'node:test';

import type { NimiAiModel } from '../../core/ai';
import { createNimiOpenAICompatibleAdapter } from '../openai-compatible';
import {
  createNimiNextChatCompletionRoute,
  NIMI_NEXT_ADAPTER_MANIFEST,
  NIMI_NEXT_UNSUPPORTED_FEATURE_CODE,
  NimiNextUnsupportedFeatureError,
} from './index';

test('next adapter creates structural JSON chat completion route', async () => {
  const openAICompatible = createNimiOpenAICompatibleAdapter({
    model: createModel(),
    idGenerator: () => 'chatcmpl-next',
    createdUnixSeconds: () => 123,
  });
  const route = createNimiNextChatCompletionRoute({
    completions: openAICompatible.chat.completions,
  });

  const response = await route({
    async json() {
      return {
        model: 'next-model',
        messages: [{ role: 'user', content: 'hi' }],
      };
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/json');
  assert.equal((response.body as { id: string }).id, 'chatcmpl-next');
});

test('next adapter fails closed for streaming route semantics', async () => {
  const openAICompatible = createNimiOpenAICompatibleAdapter({ model: createModel() });
  const route = createNimiNextChatCompletionRoute({
    completions: openAICompatible.chat.completions,
  });

  await assert.rejects(
    route({
      async json() {
        return {
          model: 'next-model',
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        };
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof NimiNextUnsupportedFeatureError);
      assert.equal(error.code, NIMI_NEXT_UNSUPPORTED_FEATURE_CODE);
      assert.equal(error.feature, 'route.chatCompletions.stream');
      return true;
    },
  );
});

test('next manifest does not claim middleware or server action parity', () => {
  assert.equal(NIMI_NEXT_ADAPTER_MANIFEST.capabilities['route.chatCompletions.json'], 'supported');
  assert.equal(NIMI_NEXT_ADAPTER_MANIFEST.capabilities.middleware, 'unsupported');
  assert.equal(NIMI_NEXT_ADAPTER_MANIFEST.capabilities.serverActions, 'unsupported');
});

function createModel(): NimiAiModel {
  return {
    model: { providerId: 'test', modelId: 'next-model' },
    async generateText() {
      return { text: 'next response', finishReason: 'stop' };
    },
  };
}
