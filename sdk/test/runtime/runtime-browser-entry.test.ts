import assert from 'node:assert/strict';
import test from 'node:test';

import * as runtimeBrowser from '../../src/runtime/browser.js';

test('browser runtime entry exports the raw runtime client factory', () => {
  assert.equal(typeof runtimeBrowser.createRuntimeClient, 'function');
});
