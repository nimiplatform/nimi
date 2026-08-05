import assert from 'node:assert/strict';
import test from 'node:test';

import type { NimiAiModel } from '../../core/ai';
import { textPart } from '../../core/contracts';
import {
  createNimiLangGraphAdapter,
  NIMI_LANGGRAPH_ADAPTER_MANIFEST,
  NIMI_LANGGRAPH_UNSUPPORTED_FEATURE_CODE,
  NimiLangGraphUnsupportedFeatureError,
} from './index';

test('langgraph adapter exposes L1 model node mapping', async () => {
  const adapter = createNimiLangGraphAdapter({ model: createModel() });
  const state = await adapter.node({
    messages: [{ role: 'user', content: [textPart('hi')] }],
  });

  assert.equal(adapter.manifest.capabilityLevel, 'L1');
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[1]?.role, 'assistant');
});

test('langgraph adapter fails closed for checkpoint resume', () => {
  const adapter = createNimiLangGraphAdapter({ model: createModel() });

  assert.throws(
    () => adapter.checkpointResume(),
    (error: unknown) => {
      assert.ok(error instanceof NimiLangGraphUnsupportedFeatureError);
      assert.equal(error.code, NIMI_LANGGRAPH_UNSUPPORTED_FEATURE_CODE);
      assert.equal(error.feature, 'checkpointResume');
      return true;
    },
  );
});

test('langgraph manifest leaves L2/L4 claims unsupported', () => {
  assert.equal(NIMI_LANGGRAPH_ADAPTER_MANIFEST.capabilities['node.generate'].support, 'supported');
  assert.equal(NIMI_LANGGRAPH_ADAPTER_MANIFEST.capabilities['node.toolMapping'].support, 'unsupported');
  assert.equal(NIMI_LANGGRAPH_ADAPTER_MANIFEST.capabilities.checkpointResume.support, 'unsupported');
});

function createModel(): NimiAiModel {
  return {
    model: { modelId: 'text.generate' },
    async generateText() {
      return { text: 'next', finishReason: 'stop' };
    },
  };
}
