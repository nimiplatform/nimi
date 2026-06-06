import assert from 'node:assert/strict';
import test from 'node:test';

import { extractGenerateText } from '../../src/ai-provider/helpers.js';
import { ReasonCode } from '../../src/types/index.js';
import { textEmbedOutput, textGenerateOutput } from '../helpers/runtime-ai-shapes.js';

test('ai-provider extractGenerateText reuses typed scenario text parsing', () => {
  assert.equal(extractGenerateText(textGenerateOutput('hello from provider')), 'hello from provider');
  assert.throws(
    () => extractGenerateText(undefined),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      return true;
    },
  );
  assert.throws(
    () => extractGenerateText(textEmbedOutput([[1, 2]])),
    (error: Error & { reasonCode?: string }) => {
      assert.equal(error.reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      return true;
    },
  );
});
