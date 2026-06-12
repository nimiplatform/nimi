/**
 * T10.4 — Support secondary surface render coverage (`D-SUP-001..008`).
 *
 * Static-markup render proofs:
 *   - the Support panel mounts the fixed five-item sub-area sidebar;
 *   - the typed fail-closed surface renders the typed reason + retry;
 *   - each sub-area starts in a non-fabricated state (loading), never a
 *     synthesized "ready" placeholder, before its typed projection resolves;
 *   - the degraded entry only exposes repair + recovery.
 *
 * Effects do not run under `renderToStaticMarkup`, so a freshly mounted
 * sub-area renders its initial pre-projection state — which the contract
 * requires to be a typed loading state, not placeholder product data.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Some transitively rendered kit primitives (ScrollArea via @radix-ui) are
// CJS bundles compiled with the classic JSX runtime and expect a global
// `React`. The test runner compiles project `.tsx` with the automatic
// runtime, so expose `React` globally for those CJS dependencies.
(globalThis as { React?: typeof React }).React = React;

import { initI18n } from '../src/shell/renderer/i18n';
import { SupportPanel } from '../src/shell/renderer/features/support/support-panel';
import { SupportFailClosed } from '../src/shell/renderer/features/support/support-section-shell';
import { SupportRepairSection } from '../src/shell/renderer/features/support/support-repair-section';
import { SupportUpdatesSection } from '../src/shell/renderer/features/support/support-updates-section';
import { SupportDiagnosticsSection } from '../src/shell/renderer/features/support/support-diagnostics-section';
import { SupportLogsSection } from '../src/shell/renderer/features/support/support-logs-section';
import { SupportRecoverySection } from '../src/shell/renderer/features/support/support-recovery-section';
import { SupportDegradedEntry } from '../src/shell/renderer/features/support/support-degraded-entry';

test.before(async () => {
  await initI18n();
});

test('D-SUP-001/002: the Support panel renders the five-item sub-area sidebar', () => {
  const markup = renderToStaticMarkup(React.createElement(SupportPanel));
  assert.match(markup, /data-testid="panel:support"/);
  assert.match(markup, /data-testid="panel:support-sidebar"/);
  for (const section of ['repair', 'updates', 'diagnostics', 'logs', 'recovery']) {
    assert.match(markup, new RegExp(`data-testid="support-nav:${section}"`));
  }
});

test('D-SUP-003..007: the typed fail-closed surface shows the typed reason and retry', () => {
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
    element: React.createElement(SupportRepairSection, { onNavigateToRecovery: () => {} }),
    loadingTestId: 'support-repair-loading',
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
  {
    name: 'recovery',
    element: React.createElement(SupportRecoverySection, { onNavigateToRepair: () => {} }),
    loadingTestId: 'support-recovery-loading',
  },
];

for (const section of SECTIONS) {
  test(`D-SUP-003..007: ${section.name} starts in a typed loading state, not placeholder data`, () => {
    const markup = renderToStaticMarkup(section.element);
    assert.match(markup, new RegExp(`data-testid="support-section-${section.name}"`));
    // Before the typed projection resolves the sub-area shows loading — never
    // a fabricated ready surface.
    assert.match(markup, new RegExp(`data-testid="${section.loadingTestId}"`));
  });
}

test('D-SUP-004: updates fails closed before the release projection arrives', () => {
  // The updates sub-area reads the release projection from the app store
  // (synchronously available, null on a cold store). It must render the
  // section frame without crashing and without fabricating version rows.
  const markup = renderToStaticMarkup(React.createElement(SupportUpdatesSection));
  assert.match(markup, /data-testid="support-section-updates"/);
  assert.match(markup, /data-testid="support-updates-fail-closed"/);
  assert.doesNotMatch(markup, /data-testid="support-updates-versions"/);
});

test('D-SUP-008: the degraded entry renders only the trigger when closed', () => {
  const markup = renderToStaticMarkup(React.createElement(SupportDegradedEntry));
  assert.match(markup, /data-testid="support-degraded-entry-trigger"/);
  // The overlay is closed by default — no Support sub-area is mounted until
  // the user opens it.
  assert.doesNotMatch(markup, /data-testid="support-degraded-overlay"/);
});
