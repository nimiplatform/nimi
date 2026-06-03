import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const invokeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/invoke.ts'),
  'utf8',
);

test('D-ERR-007: Desktop bridge consumes SDK reason projection instead of re-owning Phase 1 reason map', () => {
  assert.match(invokeSource, /toShellBridgeNimiError/);
  assert.match(invokeSource, /getShellBridgeUserMessageProjection/);
  assert.doesNotMatch(invokeSource, /getRuntimeReasonCodeMessage/);
  assert.doesNotMatch(invokeSource, /AI_PROVIDER_TIMEOUT:\s*\{/);
  assert.doesNotMatch(invokeSource, /DESKTOP_HTTP_METHOD_INVALID:\s*\{/);
});
