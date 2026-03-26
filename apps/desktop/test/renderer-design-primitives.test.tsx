import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { Button, IconButton, SidebarHeader, SidebarItem, SidebarResizeHandle, SidebarSearch, SidebarSection, SidebarShell, Surface } from '@nimiplatform/nimi-kit/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { STATE_TONE_CLASS } from '../src/shell/renderer/components/design-tokens.js';

test('surface renders with tone and elevation', () => {
  const markup = renderToStaticMarkup(
    <Surface tone="panel" elevation="raised" data-testid="surface-check">
      content
    </Surface>,
  );

  assert.match(markup, /data-testid="surface-check"/u);
  assert.match(markup, /content/u);
});

test('button and icon button render correctly', () => {
  const buttonMarkup = renderToStaticMarkup(
    <Button tone="primary">Primary</Button>,
  );
  const iconButtonMarkup = renderToStaticMarkup(
    <IconButton tone="ghost" icon={<span>x</span>} aria-label="icon action" />,
  );

  assert.match(buttonMarkup, /Primary/u);
  assert.match(iconButtonMarkup, /aria-label="icon action"/u);
});

test('design tokens export state tone classes with nimi tokens', () => {
  assert.match(STATE_TONE_CLASS.selected, /nimi-surface-active/u);
  assert.match(STATE_TONE_CLASS.danger, /nimi-status-danger/u);
});

test('sidebar primitives render structure', () => {
  const markup = renderToStaticMarkup(
    <SidebarShell data-testid="sidebar-shell">
      <SidebarHeader title="Title" />
      <SidebarSearch
        value="abc"
        onChange={() => {}}
        placeholder="Search"
        primaryAction={<span>+</span>}
      />
      <SidebarSection label="Core">
        <SidebarItem
          kind="nav-row"
          active
          label="Runtime"
          trailing={<span>3</span>}
        />
      </SidebarSection>
      <SidebarResizeHandle ariaLabel="resize" onMouseDown={() => {}} />
    </SidebarShell>,
  );

  assert.match(markup, /aside/u);
  assert.match(markup, /Title/u);
  assert.match(markup, /Search/u);
  assert.match(markup, /Core/u);
  assert.match(markup, /Runtime/u);
  assert.match(markup, /data-testid="sidebar-shell"/u);
});
