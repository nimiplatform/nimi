import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_NEXT_ADAPTER_MANIFEST,
  NIMI_NEXT_UNSUPPORTED_FEATURE_CODE,
  NimiNextUnsupportedFeatureError,
  createNimiNextChatCompletionRoute,
  throwUnsupportedNextFeature,
} from './index';
import * as nextAdapter from './index';
import type { NimiGenerateTextRequest, NimiGenerateTextResult } from '../../core/ai';

test('next adapter exposes a stable OpenAI-compatible JSON chat completion route', async () => {
  assert.equal('createNimiNextChatCompletionRoute' in nextAdapter, true);
  assert.equal(NIMI_NEXT_ADAPTER_MANIFEST.capabilities['route.chatCompletions.json'].support, 'supported');

  const requests: NimiGenerateTextRequest[] = [];
  const route = createNimiNextChatCompletionRoute({
    model: {
      model: {
        modelId: 'text.generate',
      },
      async generateText(request): Promise<NimiGenerateTextResult> {
        requests.push(request);
        return {
          text: 'hello from next',
          finishReason: 'stop',
          usage: {
            promptTokens: 1,
            completionTokens: 3,
            totalTokens: 4,
          },
        };
      },
    },
  });

  const response = await route.POST(new Request('https://local.test/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      model: 'text.generate',
      messages: [{ role: 'user', content: 'hello' }],
    }),
  }));
  const json = await response.json() as { choices: Array<{ message: { content: string } }> };

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(json.choices[0]?.message.content, 'hello from next');
  assert.equal(requests[0]?.messages[0]?.role, 'user');
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

test('next manifest only claims JSON route support', () => {
  assert.equal(NIMI_NEXT_ADAPTER_MANIFEST.capabilities['route.chatCompletions.json'].support, 'supported');
  assert.equal(NIMI_NEXT_ADAPTER_MANIFEST.capabilities['route.chatCompletions.stream'].support, 'unsupported');
  assert.equal(NIMI_NEXT_ADAPTER_MANIFEST.capabilities.middleware.support, 'unsupported');
  assert.equal(NIMI_NEXT_ADAPTER_MANIFEST.capabilities.serverActions.support, 'unsupported');
});
