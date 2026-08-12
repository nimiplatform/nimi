import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TFunction } from 'i18next';
import { CloudConnectorGrantPanel } from '../src/shell/renderer/features/runtime-config/runtime-config-page-cloud-grants.js';
import { DesktopMotionProvider } from '../src/shell/renderer/ui/motion/desktop-motion.js';

const t = ((_: string, options?: { defaultValue?: string; count?: number; timestamp?: string }) => (
  String(options?.defaultValue || '')
    .replace('{{count}}', String(options?.count ?? ''))
    .replace('{{timestamp}}', String(options?.timestamp ?? ''))
)) as TFunction;

test('Connectors page lists active and revoked account authorization lifecycle separately from routing', () => {
  const markup = renderToStaticMarkup(React.createElement(DesktopMotionProvider, null, React.createElement(CloudConnectorGrantPanel, {
    authenticated: true,
    busyConnectorId: '',
    busyGrantId: '',
    connectors: [{
      id: 'connector-1',
      label: 'Work account',
      vendor: 'openai',
      provider: 'openai',
      authMode: 'api_key',
      endpoint: '',
      scope: 'user',
      hasCredential: true,
      isSystemOwned: false,
      models: [],
      status: 'healthy',
      lastCheckedAt: null,
      lastDetail: '',
    }],
    grants: [{
      grantId: 'grant-active',
      connectorId: 'connector-1',
      status: 'active',
      createdAt: '2026-08-05T00:00:00.000Z',
      revokedAt: null,
    }, {
      grantId: 'grant-revoked',
      connectorId: 'connector-1',
      status: 'revoked',
      createdAt: '2026-08-01T00:00:00.000Z',
      revokedAt: '2026-08-02T00:00:00.000Z',
    }],
    loading: false,
    onCreate: async () => {},
    onRevoke: async () => {},
    selectedConnector: null,
    t,
  })));

  assert.match(markup, /Account authorizations/);
  assert.match(markup, /never selects a provider-model target or controls routing/);
  assert.match(markup, /grant-active/);
  assert.match(markup, /grant-revoked/);
  assert.match(markup, />Revoke</);
  assert.equal((markup.match(/>Revoke</g) || []).length, 1);
});

test('Connectors page offers explicit account authorization for the selected ungranted connector', () => {
  const connector = {
    id: 'connector-dashscope',
    label: 'Dashscope',
    vendor: 'dashscope' as const,
    provider: 'dashscope',
    authMode: 'api_key' as const,
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    scope: 'user' as const,
    hasCredential: true,
    isSystemOwned: false,
    models: ['cosyvoice-v3.5-plus'],
    status: 'healthy' as const,
    lastCheckedAt: null,
    lastDetail: '',
  };
  const markup = renderToStaticMarkup(React.createElement(DesktopMotionProvider, null, React.createElement(CloudConnectorGrantPanel, {
    authenticated: true,
    busyConnectorId: '',
    busyGrantId: '',
    connectors: [connector],
    grants: [],
    loading: false,
    onCreate: async () => {},
    onRevoke: async () => {},
    selectedConnector: connector,
    t,
  })));

  assert.match(markup, /Authorize connector/);
  assert.match(markup, /Model and route selection remain separate/);
});
