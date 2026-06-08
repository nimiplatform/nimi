import assert from 'node:assert/strict';
import test from 'node:test';

import type { NimiAiModel } from '../../core/ai';
import { textPart } from '../../core/contracts';
import {
  createNimiMastraAdapter,
  NIMI_MASTRA_ADAPTER_MANIFEST,
  NIMI_MASTRA_UNSUPPORTED_FEATURE_CODE,
  NimiMastraUnsupportedFeatureError,
} from './index';

test('mastra adapter exposes L1 structural generation', async () => {
  const model = createGenerateOnlyModel('mastra-model');
  const adapter = createNimiMastraAdapter({ model });

  const result = await adapter.model.generate({
    messages: [{ role: 'user', content: [textPart('hi')] }],
  });

  assert.equal(adapter.manifest.capabilityLevel, 'L1');
  assert.equal(adapter.model.provider, 'nimi');
  assert.equal(adapter.model.modelId, 'mastra-model');
  assert.equal(result.text, 'mastra-model:hi');
});

test('mastra adapter fails closed for unsupported streaming', () => {
  const adapter = createNimiMastraAdapter({ model: createGenerateOnlyModel('mastra-model') });

  assert.throws(
    () => adapter.model.stream(),
    (error: unknown) => {
      assert.ok(error instanceof NimiMastraUnsupportedFeatureError);
      assert.equal(error.code, NIMI_MASTRA_UNSUPPORTED_FEATURE_CODE);
      assert.equal(error.feature, 'model.stream');
      return true;
    },
  );
});

test('mastra manifest does not claim tool or structured-output parity', () => {
  assert.equal(NIMI_MASTRA_ADAPTER_MANIFEST.capabilities['model.generate'].support, 'supported');
  assert.equal(NIMI_MASTRA_ADAPTER_MANIFEST.capabilities['tools.mapping'].support, 'unsupported');
  assert.equal(NIMI_MASTRA_ADAPTER_MANIFEST.capabilities.structuredOutput.support, 'unsupported');
});

function createGenerateOnlyModel(modelId: string): NimiAiModel {
  return {
    model: { providerId: 'test', modelId },
    async generateText(request) {
      return {
        text: `${modelId}:${request.messages.flatMap((message) => message.content).map((part) => (part.type === 'text' ? part.text : '')).join('')}`,
        finishReason: 'stop',
      };
    },
  };
}
