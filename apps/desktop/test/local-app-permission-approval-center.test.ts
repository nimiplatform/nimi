import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { resolveLocalAppPermissionApprovalViewState } from '../src/shell/renderer/features/apps/local-app-permission-approval-center.js';

test('permission approval center keeps loading, pending, denied, and error states explicit', () => {
  assert.equal(resolveLocalAppPermissionApprovalViewState({
    hasRequest: false, failed: false, decisionState: 'pending',
  }), 'hidden');
  assert.equal(resolveLocalAppPermissionApprovalViewState({
    hasRequest: true, failed: false, decisionState: 'pending',
  }), 'pending');
  assert.equal(resolveLocalAppPermissionApprovalViewState({
    hasRequest: true, failed: false, decisionState: 'denied',
  }), 'denied');
  assert.equal(resolveLocalAppPermissionApprovalViewState({
    hasRequest: true, failed: true, decisionState: 'pending',
  }), 'error');
});

test('permission dialog presents account-wide current-and-future scope without protected identities', async () => {
  const source = await readFile(new URL(
    '../src/shell/renderer/features/apps/local-app-permission-approval-center.tsx',
    import.meta.url,
  ), 'utf8');
  assert.match(source, /requests to interact with your Agents/u);
  assert.match(source, /request\.reason/u);
  assert.match(source, /every Agent in your account/u);
  assert.match(source, /Current and future Agents/u);
  assert.doesNotMatch(source, /permissionId/u);
  assert.doesNotMatch(source, /operationId|resourceId|conversationAnchor/u);
  assert.doesNotMatch(source, />\s*\{request\.requestKey\}\s*</u);
});

test('permission dialog uses the trapped overlay without an Agent picker', async () => {
  const source = await readFile(new URL(
    '../src/shell/renderer/features/apps/local-app-permission-approval-center.tsx',
    import.meta.url,
  ), 'utf8');
  assert.match(source, /<OverlayShell/u);
  assert.match(source, /closeOnBackdrop=\{false\}/u);
  assert.doesNotMatch(source, /<fieldset|type="radio"|selectedAgentKey|fetchLocalAgentList/u);
});
