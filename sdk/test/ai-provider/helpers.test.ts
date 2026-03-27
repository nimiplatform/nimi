import assert from 'node:assert/strict';
import test from 'node:test';

import { extractGenerateText } from '../../src/ai-provider/helpers.js';
import { textEmbedOutput, textGenerateOutput } from '../helpers/runtime-ai-shapes.js';

test('ai-provider extractGenerateText reuses typed scenario text parsing', () => {
  assert.equal(extractGenerateText(textGenerateOutput('hello from provider')), 'hello from provider');
  assert.equal(extractGenerateText(undefined), '');
  assert.equal(extractGenerateText(textEmbedOutput([[1, 2]])), '');
});
