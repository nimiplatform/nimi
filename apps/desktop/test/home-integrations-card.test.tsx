import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomeIntegrationsCard } from '../src/shell/renderer/features/home/home-integrations-card.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n/index.js';

(globalThis as { React?: typeof React }).React = React;

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
