import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiApprovalTool } from '../../features/toolkits';
import {
  createNimiMcpAdapter,
  NIMI_MCP_ADAPTER_MANIFEST,
  NIMI_MCP_UNSUPPORTED_FEATURE_CODE,
  NimiMcpUnsupportedFeatureError,
} from './index';

test('mcp adapter lists and calls auto Nimi tools', async () => {
  const adapter = createNimiMcpAdapter({
    tools: [
      {
        name: 'echo',
        description: 'Echo input.',
        inputSchema: { type: 'object' },
        policy: 'auto',
        visibility: 'model',
        execute(input) {
          return input;
        },
      },
    ],
  });

  assert.equal(adapter.manifest.capabilityLevel, 'L2');
  assert.deepEqual(adapter.listTools(), [
    {
      name: 'echo',
      description: 'Echo input.',
      inputSchema: { type: 'object' },
    },
  ]);
  assert.deepEqual(await adapter.callTool({ name: 'echo', arguments: { ok: true } }), {
    content: [{ type: 'text', text: '{"ok":true}' }],
    structuredContent: { ok: true },
  });
});

test('mcp adapter fails closed on owner-gated approval/external semantics', async () => {
  const adapter = createNimiMcpAdapter({
    tools: [createNimiApprovalTool({ name: 'approve', description: 'Approve work' })],
  });

  await assert.rejects(
    adapter.callTool({ name: 'approve', arguments: {} }),
    (error: unknown) => {
      assert.ok(error instanceof NimiMcpUnsupportedFeatureError);
      assert.equal(error.code, NIMI_MCP_UNSUPPORTED_FEATURE_CODE);
      assert.equal(error.feature, 'mcp.approval');
      return true;
    },
  );
});

test('mcp adapter maps Nimi run events to MCP notifications', () => {
  const adapter = createNimiMcpAdapter({ tools: [] });
  const notifications = adapter.runEventNotifications([
    { type: 'text-delta', text: 'hi' },
    { type: 'tool-call', toolCall: { id: 'call_1', name: 'lookup', arguments: {} } },
  ]);

  assert.deepEqual(
    notifications.map((notification) => notification.method),
    ['notifications/message', 'notifications/progress', 'notifications/message'],
  );
});

test('mcp manifest declares unsupported L3 behavior explicitly', () => {
  assert.equal(NIMI_MCP_ADAPTER_MANIFEST.capabilities.approval, 'unsupported');
  assert.equal(NIMI_MCP_ADAPTER_MANIFEST.capabilities.externalExecution, 'unsupported');
});
