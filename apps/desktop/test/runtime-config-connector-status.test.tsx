import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { TooltipProvider } from '@nimiplatform/kit/ui';
import { CloudConnectorStatus, connectorPresentationState } from '../src/shell/renderer/features/runtime-config/runtime-config-page-cloud-connector-list.js';
import { normalizeConnectorV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types.js';
import { i18n, initI18n, changeLocale } from '../src/shell/renderer/i18n/index.js';

(globalThis as { React?: typeof React }).React = React;

test('a disabled connection never presents its historical successful check as current availability', () => {
  const connector = normalizeConnectorV11({ id: 'disabled', hasCredential: true, managementStatus: 'disabled', status: 'healthy' });
  assert.equal(connectorPresentationState(connector), 'disabled');
});

test('connection labels show durable outcomes with neutral unknown and checking states', async () => {
  await initI18n();
  await changeLocale('zh');
  const connector = normalizeConnectorV11({ id: 'saved', hasCredential: true, status: 'healthy', lastCheckedAt: '2026-01-01T00:00:00Z' });
  const cases = [
    { status: 'healthy', checking: false, tone: 'success', label: '检查通过' },
    { status: 'unreachable', checking: false, tone: 'danger', label: '检查失败' },
    { status: 'idle', checking: false, tone: 'neutral', label: '未检查' },
    { status: 'healthy', checking: true, tone: 'neutral', label: null },
  ] as const;
  for (const scenario of cases) {
    const html = renderToStaticMarkup(<TooltipProvider><CloudConnectorStatus
      connector={{ ...connector, status: scenario.status }} checking={scenario.checking} t={i18n.t.bind(i18n)} /></TooltipProvider>);
    const document = JSDOM.fragment(html);
    const badge = document.querySelector(`.nimi-status-badge--${scenario.tone}`);
    assert.ok(badge);
    if (scenario.label) assert.equal(badge.textContent, scenario.label);
    assert.ok(document.querySelector('[tabindex="0"]'));
    assert.equal(document.querySelector('[role="tooltip"]'), null);
    assert.doesNotMatch(document.textContent!, /2026|上次检查/);
  }
});
