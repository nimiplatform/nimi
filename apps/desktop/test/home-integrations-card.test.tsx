import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomeIntegrationsCard } from '../src/shell/renderer/features/home/home-integrations-card.js';
import { HomeIntegrationsWorkbenchView } from '../src/shell/renderer/features/home/home-integrations-workbench.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n/index.js';

(globalThis as { React?: typeof React }).React = React;

test('Home omits the integrations card completely when neither active connections nor app permissions exist', async () => {
  await initI18n(); await changeLocale('en');
  const client = new QueryClient();
  client.setQueryData(['nimi-overview', 'integration-management'], {
    targets: [],
    calls: [],
    consumers: [],
    permissions: [{ consumerRef: 'empty', operations: [] }],
  });
  const bindings = { sdk: { appProduct: () => ({ integration: {} }) } } as unknown as DesktopCanonicalRendererBindings;
  try {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <DesktopRendererBindingProvider bindings={bindings}>
          <HomeIntegrationsCard appIconUrls={new Map()} onOpen={() => {}} />
        </DesktopRendererBindingProvider>
      </QueryClientProvider>,
    );
    assert.equal(html, '');
  } finally {
    client.clear();
  }
});

test('Home counts authorized apps once across registrations while retaining historical consumers', async () => {
  await initI18n(); await changeLocale('en');
  const client = new QueryClient();
  client.setQueryData(['nimi-overview', 'integration-management'], {
    targets: [], calls: [],
    consumers: [
      { consumerRef: 'first-registration', appId: 'lab', displayName: 'Lab' },
      { consumerRef: 'second-registration', appId: 'lab', displayName: 'Lab' },
    ],
    permissions: [
      { consumerRef: 'first-registration', operations: ['read'] },
      { consumerRef: 'second-registration', operations: ['write'] },
      { consumerRef: 'removed', consumer: { appId: 'retired', displayName: 'Retired app' }, operations: ['read'] },
      { consumerRef: 'empty', operations: [] },
    ],
  });
  const bindings = { sdk: { appProduct: () => ({ integration: {} }) } } as unknown as DesktopCanonicalRendererBindings;
  try {
    const html = renderToStaticMarkup(<QueryClientProvider client={client}>
      <DesktopRendererBindingProvider bindings={bindings}>
        <HomeIntegrationsCard appIconUrls={new Map()} onOpen={() => {}} />
      </DesktopRendererBindingProvider>
    </QueryClientProvider>);
    assert.match(html, /2 apps have integration access/);
    assert.match(html, /Retired app/);
    assert.doesNotMatch(html, /3 apps have integration access/);
  } finally { client.clear(); }
});

test('Home integrations workbench renders all built-in services, connection counts, and permissions/calls actions', async () => {
  await initI18n(); await changeLocale('zh');
  const html = renderToStaticMarkup(
    <HomeIntegrationsWorkbenchView
      loading={false}
      unavailable={false}
      snapshot={{
        targets: [
          { targetRef: 't1', kind: 'feishu', displayName: '工作飞书', available: true, operations: [] },
          { targetRef: 't2', kind: 'mcp', displayName: 'Local MCP', available: true, operations: [] },
        ] as never,
        calls: [],
        consumers: [{ consumerRef: 'c1', appId: 'nimi.lab', displayName: 'Nimi Lab' }] as never,
        permissions: [{ consumerRef: 'c1', targetRef: 't1', operations: ['read'] }] as never,
      }}
      appIconUrls={new Map()}
      onOpen={() => {}}
    />,
  );
  assert.match(html, /data-testid="home-integrations-workbench"/);
  assert.match(html, /已连接 2 个 · 1 个应用已授权/);
  assert.match(html, /data-testid="home-integration-service:feishu"[^>]*data-connected="true"/);
  assert.match(html, /data-testid="home-integration-service:mcp"[^>]*data-connected="true"/);
  assert.match(html, /data-testid="home-integration-service:weixin"[^>]*data-connected="false"/);
  assert.match(html, /aria-label="添加 个人微信（iLink）"/);
  assert.match(html, /data-testid="home-integration-add-hint:weixin"[^>]*>.*添加/);
  assert.doesNotMatch(html, /data-testid="home-integration-add-hint:feishu"/);
  assert.match(html, /data-testid="home-integrations-permissions"/);
  assert.match(html, /data-testid="home-integrations-calls"/);
});

test('Home integrations workbench uses dashed addable styling and English add affordances when unconnected', async () => {
  await initI18n(); await changeLocale('en');
  const html = renderToStaticMarkup(
    <HomeIntegrationsWorkbenchView
      loading={false}
      unavailable={false}
      snapshot={{
        targets: [],
        calls: [],
        consumers: [],
        permissions: [],
      }}
      appIconUrls={new Map()}
      onOpen={() => {}}
    />,
  );
  assert.doesNotMatch(html, /data-testid="home-integrations-summary"/);
  assert.match(html, /aria-label="Add Feishu"[^>]*data-testid="home-integration-service:feishu"[^>]*data-connected="false"[^>]*border-dashed/);
  assert.match(html, /data-testid="home-integration-add-hint:feishu"[^>]*>.*Add/);
});
