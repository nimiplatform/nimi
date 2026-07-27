import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SidebarItem, SidebarSection } from '@nimiplatform/kit/ui';
import { RUNTIME_SIDEBAR_ITEMS } from '../src/shell/renderer/features/runtime-config/runtime-config-sidebar';

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
              label={item.label}
              icon={item.icon}
            />
          ))}
        </SidebarSection>
      ))}
    </>,
  );
}

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
  assert.doesNotMatch(markup, /AI Runtime/);
});
