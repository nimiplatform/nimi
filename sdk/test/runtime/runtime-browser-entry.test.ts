import assert from 'node:assert/strict';
import test from 'node:test';

import * as runtimeIndex from '../../src/runtime/index.js';
import * as runtimeBrowser from '../../src/runtime/browser.js';

test('browser runtime entry exports the raw runtime client factory', () => {
  assert.equal(typeof runtimeBrowser.createRuntimeClient, 'function');
});

test('browser runtime entry exports delegated control enum values for Desktop controls', () => {
  assert.equal(runtimeBrowser.DelegatedProviderKind.MCP_TOOL_PROVIDER, 1);
  assert.equal(runtimeBrowser.DelegatedProviderState.READY, 3);
  assert.equal(runtimeBrowser.DelegatedApprovalDecision.APPROVE, 1);
  assert.equal(runtimeBrowser.DelegatedTransportKind.STDIO_COMMAND, 1);
});

test('runtime entry exports delegated control enum values for Desktop controls', () => {
  assert.equal(runtimeIndex.DelegatedProviderKind.MCP_TOOL_PROVIDER, 1);
  assert.equal(runtimeIndex.DelegatedProviderState.READY, 3);
  assert.equal(runtimeIndex.DelegatedApprovalDecision.APPROVE, 1);
  assert.equal(runtimeIndex.DelegatedTransportKind.STDIO_COMMAND, 1);
});
