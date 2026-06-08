import assert from 'node:assert/strict';
import test from 'node:test';

import type { NimiAiModel } from '../../core/ai';
import {
  createNimiLlamaIndexAdapter,
  NIMI_LLAMA_INDEX_ADAPTER_MANIFEST,
  NIMI_LLAMA_INDEX_UNSUPPORTED_FEATURE_CODE,
  NimiLlamaIndexUnsupportedFeatureError,
} from './index';

test('llamaindex adapter exposes L1 query generation with references', async () => {
  const adapter = createNimiLlamaIndexAdapter({ model: createModel() });
  const result = await adapter.query({
    query: 'What is Nimi?',
    context: [{ id: 'ref-1', source: 'doc', text: 'Nimi is a realm runtime.', score: 1 }],
  });

  assert.equal(adapter.manifest.capabilityLevel, 'L1');
  assert.equal(result.response, 'answer');
  assert.equal(result.sourceNodes[0]?.id, 'ref-1');
});

test('llamaindex adapter fails closed for index mutation', () => {
  const adapter = createNimiLlamaIndexAdapter({ model: createModel() });

  assert.throws(
    () => adapter.mutateIndex(),
    (error: unknown) => {
      assert.ok(error instanceof NimiLlamaIndexUnsupportedFeatureError);
      assert.equal(error.code, NIMI_LLAMA_INDEX_UNSUPPORTED_FEATURE_CODE);
      assert.equal(error.feature, 'indexMutation');
      return true;
    },
  );
});

test('llamaindex manifest does not claim index mutation or tool calling', () => {
  assert.equal(NIMI_LLAMA_INDEX_ADAPTER_MANIFEST.capabilities['query.generate'].support, 'supported');
  assert.equal(NIMI_LLAMA_INDEX_ADAPTER_MANIFEST.capabilities.indexMutation.support, 'unsupported');
  assert.equal(NIMI_LLAMA_INDEX_ADAPTER_MANIFEST.capabilities.toolCalling.support, 'unsupported');
});

function createModel(): NimiAiModel {
  return {
    model: { providerId: 'test', modelId: 'llamaindex-model' },
    async generateText() {
      return { text: 'answer', finishReason: 'stop' };
    },
  };
}
