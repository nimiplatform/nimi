import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';

test('same-named permission rows expose their distinct connection references without merging', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { IntegrationPermissionsView } = await import('../src/shell/renderer/features/integrations/integration-permissions-view.js');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  await initI18n(); await changeLocale('en');
  (globalThis as { React?: typeof React }).React = React;
  const consumer = { consumerRef: 'same-app-source', appId: 'same.app', displayName: 'Same app', sourceKind: 'development' as const };
  const snapshot = {
    targets: ['connection-a', 'connection-b'].map(targetRef => ({ targetRef, displayName: 'Same connection', kind: 'app-provided', available: false, operations: [] })),
    consumers: [consumer],
    permissions: ['connection-a', 'connection-b'].map(targetRef => ({ targetRef, consumerRef: consumer.consumerRef, operations: ['read'] })),
    calls: [],
  } as unknown as React.ComponentProps<typeof IntegrationPermissionsView>['snapshot'];
  const html = renderToStaticMarkup(<IntegrationPermissionsView snapshot={snapshot} all busy={false} onAdd={() => {}} onEdit={() => {}} onRevoke={() => {}} />);
  const dom = new JSDOM(html);
  const rows = [...dom.window.document.querySelectorAll('tbody tr')];
  assert.equal(rows.length, 2);
  rows.forEach((row, index) => {
    const detail = row.querySelector('details');
    assert.ok(detail);
    assert.equal(detail.open, false);
    assert.match(detail.textContent || '', /same-app-source/u);
    assert.ok(detail.textContent?.includes(index === 0 ? 'connection-a' : 'connection-b'));
  });
  dom.window.close();
});

