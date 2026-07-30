import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { changeLocale, i18n, initI18n } from '../src/shell/renderer/i18n/index.js';
import {
  LocalAppPermissionSettingsView,
  projectLocalAppPermissionSettingsItems,
  type LocalAppPermissionSettingsItem,
} from '../src/shell/renderer/features/apps/local-app-permission-settings.js';
import {
  DESKTOP_AGENT_PERMISSION_IDS,
  DESKTOP_DEPENDENT_AGENT_PERMISSION_IDS,
  type DesktopAgentPermissionId,
  type DesktopLocalAppPermissionPosture,
  type DesktopLocalAppPermissionProjection,
} from '../src/shell/renderer/features/apps/local-app-permission-owner.js';

(globalThis as { React?: typeof React }).React = React;

test.before(async () => {
  await initI18n();
});

const noop = () => undefined;
const permissionIds: readonly DesktopAgentPermissionId[] = DESKTOP_AGENT_PERMISSION_IDS;

function item(
  permissionId: DesktopAgentPermissionId,
  posture: DesktopLocalAppPermissionPosture = 'granted',
  effective = true,
): LocalAppPermissionSettingsItem {
  return {
    permissionId,
    posture,
    effective,
    currentAgentNames: permissionId === 'agents.interact' ? ['Mira'] : [],
  };
}

function projection(
  permissionId: DesktopAgentPermissionId,
  posture: DesktopLocalAppPermissionPosture = 'granted',
): DesktopLocalAppPermissionProjection {
  return {
    requestKey: 'principal-1',
    displayAppId: 'Zhiyu',
    permissionId,
    posture,
    coveredAgents: permissionId === 'agents.interact' && posture === 'granted'
      ? [{ agentKey: 'agent-1', displayName: 'Mira' }]
      : [],
    ownerRevision: '8',
  };
}

function render(overrides: Partial<React.ComponentProps<typeof LocalAppPermissionSettingsView>> = {}): string {
  return renderToStaticMarkup(React.createElement(LocalAppPermissionSettingsView, {
    items: [item('agents.interact')],
    loading: false,
    error: '',
    confirmingPermissionId: null,
    busyPermissionId: null,
    onRefresh: noop,
    onBeginRevoke: noop,
    onCancelRevoke: noop,
    onConfirmRevoke: noop,
    ...overrides,
  }));
}

test('Apps detail permission lifecycle shows account scope, posture, and current Agent names', () => {
  const markup = render();
  assert.match(markup, /data-testid="local-app-permission-settings"/u);
  assert.match(markup, /Interact with all Agents in your account/u);
  assert.match(markup, /current and future Agents/iu);
  assert.match(markup, /Mira/u);
  assert.match(markup, /Granted/u);
  assert.doesNotMatch(markup, /localAgentId|principal|runtime/iu);
});

test('five granted Agent items render independent revoke controls', () => {
  const markup = render({ items: permissionIds.map((permissionId) => item(permissionId)) });
  assert.equal((markup.match(/data-testid="local-app-permission-setting-/gu) ?? []).length, 5);
  assert.equal((markup.match(/data-testid="local-app-permission-revoke-/gu) ?? []).length, 5);
});

test('revoke confirmation remains separate and keyboard-operable for one item', () => {
  const markup = render({ confirmingPermissionId: 'agents.configure' });
  assert.doesNotMatch(markup, /local-app-permission-revoke-confirm-agents\.configure/u);

  const configureMarkup = render({
    items: [item('agents.configure')],
    confirmingPermissionId: 'agents.configure',
  });
  assert.match(configureMarkup, /data-testid="local-app-permission-revoke-confirm-agents\.configure"/u);
  assert.match(configureMarkup, /autofocus=""/u);
  assert.match(configureMarkup, /Confirm revoke/u);
  assert.match(configureMarkup, /Cancel/u);
});

test('interact revoke confirmation shows the authority-derived cascade warning', () => {
  const markup = render({
    items: permissionIds.map((permissionId) => item(permissionId)),
    confirmingPermissionId: 'agents.interact',
  });
  assert.match(markup, /data-testid="local-app-permission-revoke-cascade"/u);
  assert.match(markup, /immediately makes Configure Agents, Agent Voice, and Delegate Actions grants ineffective/u);
  assert.match(markup, /Read Agent Memory remains independent/u);
});

test('only granted configure, voice, and delegate become ineffective without interact', () => {
  const projected = projectLocalAppPermissionSettingsItems(
    permissionIds.slice(1).map((permissionId) => projection(permissionId)),
  );
  assert.deepEqual(DESKTOP_DEPENDENT_AGENT_PERMISSION_IDS, [
    'agents.configure',
    'agents.voice',
    'agents.delegate',
  ]);
  assert.equal(projected.find((item) => item.permissionId === 'memory.read')?.effective, true);
  for (const permissionId of DESKTOP_DEPENDENT_AGENT_PERMISSION_IDS) {
    assert.equal(projected.find((item) => item.permissionId === permissionId)?.effective, false);
  }
  const markup = render({ items: projected });
  assert.equal((markup.match(/currently ineffective because Interact with Agents is not granted/gu) ?? []).length, 3);
  const memoryRow = markup.match(
    /data-testid="local-app-permission-setting-memory\.read"[\s\S]*?(?=data-testid="local-app-permission-setting-|$)/u,
  )?.[0] || '';
  assert.doesNotMatch(memoryRow, /Requires an effective Interact|currently ineffective/u);
});

test('settings projection keeps only active granted rows', () => {
  const projected = projectLocalAppPermissionSettingsItems([
    projection('agents.interact', 'granted'),
    projection('agents.configure', 'pending'),
    projection('memory.read', 'prompt'),
    projection('agents.voice', 'unavailable'),
  ]);
  assert.deepEqual(projected.map((row) => row.permissionId), ['agents.interact']);
  assert.equal(projected[0]?.posture, 'granted');
});

test('public permission copy is complete in English and Chinese', async () => {
  await changeLocale('en');
  assert.equal(
    i18n.t('AppPermissions.approval.title', {
      app: 'Zhiyu',
      permission: i18n.t('AppPermissions.intent.agentsInteract'),
    }),
    'Zhiyu requests “Interact with all Agents in your account”',
  );
  assert.match(render(), /Interact with all Agents in your account/u);

  await changeLocale('zh');
  assert.equal(
    i18n.t('AppPermissions.approval.title', {
      app: '知遇',
      permission: i18n.t('AppPermissions.intent.agentsInteract'),
    }),
    '知遇 请求“与你账户内的全部 Agent 交互”',
  );
  assert.match(render(), /与你账户内的全部 Agent 交互/u);
  await changeLocale('en');
});

test('typed owner failure projects unavailable rather than a positive posture', () => {
  const markup = render({
    items: [item('agents.interact', 'unavailable')],
    error: 'Permission management is unavailable.',
  });
  assert.match(markup, /Unavailable/u);
  assert.match(markup, /Permission management is unavailable/u);
  assert.doesNotMatch(markup, /data-testid="local-app-permission-revoke-agents\.interact"/u);
});
