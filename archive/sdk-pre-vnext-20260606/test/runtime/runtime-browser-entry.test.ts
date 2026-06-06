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

test('browser runtime entry exports renderer runtime dependency clients', () => {
  assert.equal(typeof runtimeBrowser.createRuntimeConnectorInventoryClient, 'function');
  assert.equal(typeof runtimeBrowser.createRuntimeModelCatalogClient, 'function');
  assert.equal(typeof runtimeBrowser.RuntimeHealthCoordinator, 'function');
});

test('runtime entry exports delegated control enum values for Desktop controls', () => {
  assert.equal(runtimeIndex.DelegatedProviderKind.MCP_TOOL_PROVIDER, 1);
  assert.equal(runtimeIndex.DelegatedProviderState.READY, 3);
  assert.equal(runtimeIndex.DelegatedApprovalDecision.APPROVE, 1);
  assert.equal(runtimeIndex.DelegatedTransportKind.STDIO_COMMAND, 1);
});

test('runtime and browser runtime value exports stay aligned except Node transport', () => {
  const allowedRuntimeOnly = new Set([
    'createNodeGrpcTransport',
    'setNodeGrpcBridge',
  ]);
  const runtimeOnly = Object.keys(runtimeIndex)
    .filter((name) => !(name in runtimeBrowser))
    .filter((name) => !allowedRuntimeOnly.has(name))
    .sort();
  const browserOnly = Object.keys(runtimeBrowser)
    .filter((name) => !(name in runtimeIndex))
    .sort();

  assert.deepEqual(runtimeOnly, []);
  assert.deepEqual(browserOnly, []);
});
