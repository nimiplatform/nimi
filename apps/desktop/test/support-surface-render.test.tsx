/**
 * T10.4 — Support secondary surface render coverage (`rule.nimi.desktop.product-surfaces.r022..r029`).
 *
 * Static-markup render proofs:
 *   - the typed fail-closed surface renders the typed reason + retry;
 *   - each sub-area starts in a non-fabricated state (loading), never a
 *     synthesized "ready" placeholder, before its typed projection resolves;
 *   - recovery remains independently reachable.
 *
 * Effects do not run under `renderToStaticMarkup`, so a freshly mounted
 * sub-area renders its initial pre-projection state — which the contract
 * requires to be a typed loading state, not placeholder product data.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// Some transitively rendered kit primitives (ScrollArea via @radix-ui) are
// CJS bundles compiled with the classic JSX runtime and expect a global
// `React`. The test runner compiles project `.tsx` with the automatic
// runtime, so expose `React` globally for those CJS dependencies.
(globalThis as { React?: typeof React }).React = React;

import { initI18n } from '../src/shell/renderer/i18n';
import { ProductUpdateProvider } from '../src/shell/renderer/features/home/product-update-context';
import { SupportFailClosed } from '../src/shell/renderer/features/support/support-section-shell';
import { SupportTroubleshooting } from '../src/shell/renderer/features/support/support-troubleshooting';
import { SupportDiagnosticsSection } from '../src/shell/renderer/features/support/support-diagnostics-section';
import { SupportLogsSection } from '../src/shell/renderer/features/support/support-logs-section';
import { SupportDegradedEntry } from '../src/shell/renderer/features/support/support-degraded-entry';
import {
  DesktopRendererBindingProvider,
} from '../src/shell/renderer/renderer/binding-context';
import type {
  DesktopCanonicalRendererBindings,
} from '../src/shell/renderer/renderer/contract';
import type { ProductUpdateStatus } from '../src/shell/shared/product-update';

test.before(async () => {
  await initI18n();
});

const TEST_BINDINGS = {
  app: {
    commands: {},
    projection: { resourceBaseUrl: () => '' },
  },
} as DesktopCanonicalRendererBindings;

function renderToStaticMarkup(element: React.ReactNode): string {
  return renderMarkup(
    React.createElement(DesktopRendererBindingProvider, { bindings: TEST_BINDINGS }, element),
  );
}

test('rule.nimi.desktop.product-surfaces.r024..r028: the typed fail-closed surface shows the typed reason and retry', () => {
  const markup = renderToStaticMarkup(
    React.createElement(SupportFailClosed, {
      testId: 'support-test-fail-closed',
      reason: 'typed-projection-error: record unreadable',
      onRetry: () => {},
    }),
  );
  assert.match(markup, /data-testid="support-test-fail-closed"/);
  assert.match(markup, /data-testid="support-test-fail-closed-reason"/);
  assert.match(markup, /typed-projection-error: record unreadable/);
  assert.match(markup, /data-testid="support-test-fail-closed-retry"/);
});

const SECTIONS: Array<{ name: string; element: React.ReactElement; loadingTestId: string }> = [
  {
    name: 'repair',
    element: React.createElement(SupportTroubleshooting),
    loadingTestId: 'support-control-loading',
  },
  {
    name: 'diagnostics',
    element: React.createElement(SupportDiagnosticsSection),
    loadingTestId: 'support-diagnostics-loading',
  },
  {
    name: 'logs',
    element: React.createElement(SupportLogsSection),
    loadingTestId: 'support-logs-loading',
  },

];

for (const section of SECTIONS) {
  test(`rule.nimi.desktop.product-surfaces.r024..r028: ${section.name} starts in a typed loading state, not placeholder data`, () => {
    const markup = renderToStaticMarkup(section.element);
    assert.match(markup, new RegExp(`data-testid="${section.name === 'repair' ? 'support-troubleshooting' : `support-section-${section.name}`}"`));
    // Before the typed projection resolves the sub-area shows loading — never
    // a fabricated ready surface.
    assert.match(markup, new RegExp(`data-testid="${section.loadingTestId}"`));
  });
}

test('rule.nimi.desktop.product-surfaces.r029: the degraded entry renders only the trigger when closed', () => {
  const markup = renderToStaticMarkup(React.createElement(SupportDegradedEntry));
  assert.match(markup, /data-testid="support-degraded-entry-trigger"/);
  // The overlay is closed by default — no Support sub-area is mounted until
  // the user opens it.
  assert.doesNotMatch(markup, /data-testid="support-degraded-overlay"/);
});

test('rule.nimi.desktop.product-surfaces.r028..r029: degraded SupportTroubleshooting renders safely without ProductUpdateProvider', () => {
  const markup = renderToStaticMarkup(
    React.createElement(SupportTroubleshooting, {
      recovery: { title: 'Runtime maintenance active', detail: 'DATA_ROOT_UNAVAILABLE' },
    }),
  );
  assert.match(markup, /data-testid="support-current-gate"/);
  assert.match(markup, /Runtime maintenance active/);
  assert.doesNotMatch(markup, /data-testid="support-product-update"/);
});

test('rule.nimi.platform.product-lifecycle.p-supd-002: normal SupportTroubleshooting projects UPDATE_UPSTREAM_UNAVAILABLE status card while degraded recovery omits it', () => {
  const status: ProductUpdateStatus = {
    phase: 'failed',
    currentVersion: '0.2.0',
    channel: 'beta',
    target: 'macos-arm64',
    candidateVersion: null,
    releaseId: null,
    downloadedBytes: 0,
    totalBytes: 0,
    checkedAt: '2026-11-28T04:00:00Z',
    reason: 'UPDATE_UPSTREAM_UNAVAILABLE',
    installationAvailable: false,
    checkAvailable: true,
    recoveryAction: 'none',
    recoveryError: null,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['nimi-product-update'], status);
  const bindingsWithUpdate = {
    app: {
      commands: {
        productUpdate: {
          status: async () => status,
          check: async () => status,
          cancel: async () => status,
          homeReady: async () => status,
          reopenCurrentVersion: async () => status,
          install: async () => status,
          previewRetention: async () => ({ currentVersion: '0.2.0', runtimeVersion: '0.2.0', entries: [] }),
          cleanupRetention: async () => ({ results: [] }),
        },
      },
      projection: { resourceBaseUrl: () => '' },
    },
  } as unknown as DesktopCanonicalRendererBindings;

  const normalMarkup = renderMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        DesktopRendererBindingProvider,
        { bindings: bindingsWithUpdate },
        React.createElement(ProductUpdateProvider, null, React.createElement(SupportTroubleshooting)),
      ),
    ),
  );
  assert.match(normalMarkup, /data-testid="support-product-update"/);
  assert.match(normalMarkup, /Nimi 0\.2\.0/);
  assert.match(normalMarkup, /The update service is unavailable\. Try again later\./);
  assert.match(normalMarkup, /UPDATE_UPSTREAM_UNAVAILABLE/);
  assert.match(normalMarkup, /data-testid="support-product-update-check"/);

  const recoveryMarkup = renderMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        DesktopRendererBindingProvider,
        { bindings: bindingsWithUpdate },
        React.createElement(
          ProductUpdateProvider,
          null,
          React.createElement(SupportTroubleshooting, { recovery: { title: 'Recovery mode' } }),
        ),
      ),
    ),
  );
  assert.match(recoveryMarkup, /data-testid="support-current-gate"/);
  assert.doesNotMatch(recoveryMarkup, /data-testid="support-product-update"/);
  client.clear();
});
