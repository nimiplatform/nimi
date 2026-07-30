import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { i18n, initI18n } from '../src/shell/renderer/i18n/index.js';
import {
  groupDesktopLocalAppPermissionRequests,
  LocalAppPermissionApprovalItems,
  LocalAppPermissionDecisionActions,
  resolveLocalAppPermissionApprovalViewState,
} from '../src/shell/renderer/features/apps/local-app-permission-approval-center.js';
import {
  DESKTOP_AGENT_PERMISSION_IDS,
  DESKTOP_DEPENDENT_AGENT_PERMISSION_IDS,
  type DesktopAgentPermissionId,
  type DesktopLocalAppPermissionRequest,
} from '../src/shell/renderer/features/apps/local-app-permission-owner.js';

(globalThis as { React?: typeof React }).React = React;

test.before(async () => {
  await initI18n();
});

const permissionIds: readonly DesktopAgentPermissionId[] = DESKTOP_AGENT_PERMISSION_IDS;

function request(permissionId: DesktopAgentPermissionId): DesktopLocalAppPermissionRequest {
  return {
    requestKey: 'principal-1',
    displayAppId: 'Zhiyu',
    permissionId,
    reason: `Reason for ${permissionId}`,
    ownerRevision: '7',
  };
}

function renderRequests(
  requests: readonly DesktopLocalAppPermissionRequest[],
  interactGranted: boolean,
): string {
  const requestGroup = groupDesktopLocalAppPermissionRequests(requests)[0];
  assert.ok(requestGroup);
  return renderToStaticMarkup(React.createElement(LocalAppPermissionApprovalItems, {
    requests: requestGroup.items,
    singleItem: requestGroup.items.length === 1,
    interactGranted,
    busyPermissionId: null,
    onDecision: () => undefined,
  }));
}

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

test('five pending Agent items form one surface with a separate decision pair for every item', () => {
  const requests = permissionIds.map(request);
  const groups = groupDesktopLocalAppPermissionRequests(requests);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.items.map((item) => item.permissionId), permissionIds);

  const markup = renderRequests(requests, true);
  assert.equal((markup.match(/data-testid="local-app-permission-item-/gu) ?? []).length, 5);
  assert.equal((markup.match(/data-testid="local-app-permission-approve-/gu) ?? []).length, 5);
  assert.equal((markup.match(/data-testid="local-app-permission-deny-/gu) ?? []).length, 5);
  assert.match(markup, /Configure your Agents/u);
  assert.match(markup, /Read Agent memory/u);
  assert.match(markup, /Use Agent voice and transcription/u);
  assert.match(markup, /Delegate actions to your Agents/u);
});

test('single-item request keeps the original title and decision controls', () => {
  assert.equal(
    i18n.t('AppPermissions.approval.title', { app: 'Zhiyu' }),
    'Zhiyu requests to interact with your Agents',
  );
  const markup = renderToStaticMarkup(React.createElement(LocalAppPermissionDecisionActions, {
    request: request('agents.interact'),
    compact: false,
    interactGranted: false,
    busyPermissionId: null,
    onDecision: () => undefined,
  }));
  assert.match(markup, /data-testid="local-app-permission-approve"/u);
  assert.match(markup, /data-testid="local-app-permission-deny"/u);
  assert.doesNotMatch(markup, /local-app-permission-approve-agents/u);
});

test('only configure, voice, and delegate require interact; memory remains independently decidable', () => {
  const markup = renderRequests(permissionIds.map(request), false);
  assert.deepEqual(DESKTOP_DEPENDENT_AGENT_PERMISSION_IDS, [
    'agents.configure',
    'agents.voice',
    'agents.delegate',
  ]);
  assert.equal((markup.match(/Approve Interact with Agents first/gu) ?? []).length, 3);
  for (const permissionId of DESKTOP_DEPENDENT_AGENT_PERMISSION_IDS) {
    const escapedPermissionId = permissionId.replace('.', '\\.');
    const button = markup.match(new RegExp(
      `<button[^>]*data-testid="local-app-permission-approve-${escapedPermissionId}"[^>]*>`,
      'u',
    ))?.[0];
    assert.ok(button, `missing approve button for ${permissionId}`);
    assert.match(button, /disabled=""/u);
  }
  const memoryButton = markup.match(
    /<button[^>]*data-testid="local-app-permission-approve-memory\.read"[^>]*>/u,
  )?.[0];
  assert.ok(memoryButton);
  assert.doesNotMatch(memoryButton, /disabled=""/u);
});

test('permission dialog presents account-wide current-and-future scope without protected identities', async () => {
  const source = await readFile(new URL(
    '../src/shell/renderer/features/apps/local-app-permission-approval-center.tsx',
    import.meta.url,
  ), 'utf8');
  assert.match(source, /request\.reason/u);
  assert.doesNotMatch(source, /operationId|resourceId|conversationAnchor|selectedAgentKey|fetchLocalAgentList/u);
  assert.doesNotMatch(source, />\s*\{request\.requestKey\}\s*</u);
});

test('permission dialog uses the trapped overlay without an Agent picker', async () => {
  const source = await readFile(new URL(
    '../src/shell/renderer/features/apps/local-app-permission-approval-center.tsx',
    import.meta.url,
  ), 'utf8');
  assert.match(source, /<OverlayShell/u);
  assert.match(source, /closeOnBackdrop=\{false\}/u);
  assert.doesNotMatch(source, /<fieldset|type="radio"/u);
});
