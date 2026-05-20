/**
 * T2.5 — ordinary-tasks acceptance closeout (renderer-markup proof).
 *
 * Renders the canonical six-section Runtime sidebar through the real kit
 * `SidebarSection` / `SidebarItem` primitives — the same primitives the live
 * `RuntimeConfigPanelView` uses — and asserts the rendered markup is exactly
 * the six-section IA (Overview / Profiles / Models / Cloud Connectors /
 * Environment / Advanced) with no retired entry and no `AI Runtime` label.
 *
 * E2E posture: a real WebdriverIO screenshot of the six-section Runtime is not
 * producible in the current renderer-shell harness (the full panel pages need a
 * deep provider tree — QueryClient, Tooltip, runtime-config controller, bridge).
 * This renderer-markup test renders the genuinely-renderable IA unit; it is the
 * honest substitute. The whole-product screenshot / E2E matrix is deferred to
 * portfolio topic T11.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SidebarItem, SidebarSection } from '@nimiplatform/nimi-kit/ui';
import { RUNTIME_SIDEBAR_ITEMS } from '../src/shell/renderer/features/runtime-config/runtime-config-sidebar';
import { E2E_IDS } from '../src/shell/renderer/testability/e2e-ids';

/**
 * Mirrors the `RuntimeConfigPanelView` sidebar render: one `SidebarSection`
 * per section group, each item a `SidebarItem` carrying the renderer-owned
 * `runtimeSidebarPage` test id.
 */
function renderRuntimeSidebarMarkup(): string {
  const sections = RUNTIME_SIDEBAR_ITEMS.reduce<Record<string, typeof RUNTIME_SIDEBAR_ITEMS>>(
    (acc, item) => {
      (acc[item.section] ??= []).push(item);
      return acc;
    },
    {},
  );
  return renderToStaticMarkup(
    <>
      {Object.entries(sections).map(([section, items]) => (
        <SidebarSection key={section} label={section}>
          {items.map((item) => (
            <SidebarItem
              key={item.id}
              kind="nav-row"
              data-testid={E2E_IDS.runtimeSidebarPage(item.id)}
              label={item.label}
              icon={item.icon}
            />
          ))}
        </SidebarSection>
      ))}
    </>,
  );
}

test('rendered Runtime sidebar markup contains exactly the six section test ids', () => {
  const markup = renderRuntimeSidebarMarkup();

  for (const id of ['overview', 'profiles', 'models', 'cloud', 'environment', 'advanced']) {
    assert.match(
      markup,
      new RegExp(`data-testid="runtime-sidebar:${id}"`),
      `rendered sidebar must mount the "${id}" section`,
    );
  }

  // Retired top-level entries must not render anywhere.
  for (const retired of [
    'recommend',
    'catalog',
    'data-management',
    'performance',
    'local',
    'runtime',
    'mods',
    'mod-developer',
  ]) {
    assert.doesNotMatch(
      markup,
      new RegExp(`data-testid="runtime-sidebar:${retired}"`),
      `retired entry "${retired}" must not render in the Runtime sidebar`,
    );
  }

  // Exactly six rendered section test ids.
  const renderedIds = markup.match(/data-testid="runtime-sidebar:[a-z-]+"/g) ?? [];
  assert.equal(renderedIds.length, 6, 'exactly six section test ids must render');
});

test('rendered Runtime sidebar markup shows the six section labels and no "AI Runtime"', () => {
  const markup = renderRuntimeSidebarMarkup();

  for (const label of [
    'Overview',
    'Profiles',
    'Models',
    'Cloud Connectors',
    'Environment',
    'Advanced',
  ]) {
    assert.match(markup, new RegExp(label.replace(/ /g, '\\s')), `label "${label}" must render`);
  }

  // The retired ordinary label must never appear.
  assert.doesNotMatch(markup, /AI Runtime/, 'no "AI Runtime" label may render');
  // No retired standalone section names render as ordinary labels.
  assert.doesNotMatch(markup, />\s*Mods\s*</);
  assert.doesNotMatch(markup, />\s*Mod Developer\s*</);
  assert.doesNotMatch(markup, />\s*Data Management\s*</);
});
