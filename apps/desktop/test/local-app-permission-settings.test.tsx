import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { changeLocale, i18n, initI18n } from '../src/shell/renderer/i18n';
import { LocalAppPermissionSettingsView } from '../src/shell/renderer/features/apps/local-app-permission-settings';

(globalThis as { React?: typeof React }).React = React;

test.before(async () => {
  await initI18n();
});

const noop = () => undefined;

function render(overrides: Partial<React.ComponentProps<typeof LocalAppPermissionSettingsView>> = {}): string {
  return renderToStaticMarkup(React.createElement(LocalAppPermissionSettingsView, {
    posture: 'granted',
    currentAgentNames: ['Mira'],
    loading: false,
    error: '',
    confirming: false,
    busy: false,
    onRefresh: noop,
    onBeginRevoke: noop,
    onCancelRevoke: noop,
    onConfirmRevoke: noop,
    ...overrides,
  }));
}

test('Apps detail permission lifecycle shows account scope, posture, and current Agent names only', () => {
  const markup = render();
  assert.match(markup, /data-testid="local-app-permission-settings"/);
  assert.match(markup, /Interact with all Agents in your account/);
  assert.match(markup, /Current and future Agents are included automatically/);
  assert.match(markup, /Mira/);
  assert.match(markup, /Granted/);
  assert.doesNotMatch(markup, /agents\.interact|localAgentId|principal|conversation|runtime/i);
});

test('revoke confirmation remains separate and keyboard-operable buttons are rendered', () => {
  const markup = render({ confirming: true });
  assert.match(markup, /data-testid="local-app-permission-revoke-confirm"/);
  assert.match(markup, /autofocus=""/);
  assert.match(markup, /Confirm revoke/);
  assert.match(markup, /Cancel/);
});

test('renders the closed five-state public posture set', () => {
  for (const posture of ['prompt', 'pending', 'granted', 'denied', 'unavailable'] as const) {
    const markup = render({ posture, currentAgentNames: [] });
    assert.match(markup, new RegExp(`data-posture="${posture}"`));
  }
});

test('public permission copy is complete in English and Chinese', async () => {
  await changeLocale('en');
  assert.equal(i18n.t('AppPermissions.approval.title', { app: 'Zhiyu' }), 'Zhiyu requests to interact with your Agents');
  assert.match(render(), /Interact with all Agents in your account/);

  await changeLocale('zh');
  assert.equal(i18n.t('AppPermissions.approval.title', { app: '知遇' }), '知遇 请求与你账户内的全部 Agent 交互');
  assert.match(render(), /与你账户内的全部 Agent 交互/);
  await changeLocale('en');
});

test('typed owner failure projects unavailable rather than a positive posture', () => {
  const markup = render({
    posture: 'unavailable',
    currentAgentNames: [],
    error: 'Permission management is unavailable.',
  });
  assert.match(markup, /Unavailable/);
  assert.match(markup, /Permission management is unavailable/);
  assert.doesNotMatch(markup, /data-testid="local-app-permission-revoke"/);
});
