import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { Button, IconButton, SidebarHeader, SidebarItem, SidebarResizeHandle, SidebarSearch, SidebarSection, SidebarShell, Surface, TooltipBubble } from '@nimiplatform/nimi-ui';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SIDEBAR_AFFORDANCE_CLASS,
  SIDEBAR_FAMILY_CLASS,
  SIDEBAR_ITEM_KIND_CLASS,
  SPACING_TOKEN_VALUE,
  STATE_TONE_CLASS,
  STROKE_TOKEN_VALUE,
  TYPOGRAPHY_TOKEN_CLASS,
} from '../src/shell/renderer/components/design-tokens.js';

test('surface applies semantic tone and elevation classes', () => {
  const markup = renderToStaticMarkup(
    <Surface tone="panel" elevation="raised" data-testid="surface-check">
      content
    </Surface>,
  );

  assert.match(markup, /nimi-surface/u);
  assert.match(markup, /nimi-surface--panel/u);
  assert.match(markup, /nimi-surface--elevation-raised/u);
  assert.match(markup, /data-testid="surface-check"/u);
});

test('button and icon button expose shared action classes', () => {
  const buttonMarkup = renderToStaticMarkup(
    <Button tone="primary">Primary</Button>,
  );
  const iconButtonMarkup = renderToStaticMarkup(
    <IconButton tone="ghost" icon={<span>x</span>} aria-label="icon action" />,
  );

  assert.match(buttonMarkup, /nimi-action--primary/u);
  assert.match(iconButtonMarkup, /nimi-action--icon/u);
  assert.match(iconButtonMarkup, /aria-label="icon action"/u);
});

test('tooltip bubble exposes shared overlay classes and coordinates', () => {
  const markup = renderToStaticMarkup(
    <TooltipBubble visible coords={{ left: 12, top: 20 }} placement="bottom">
      tip
    </TooltipBubble>,
  );

  assert.match(markup, /nimi-tooltip-layer/u);
  assert.match(markup, /nimi-tooltip-bubble/u);
  assert.match(markup, /left:12px/u);
  assert.match(markup, /top:20px/u);
});

test('design tokens export semantic typography, spacing, stroke, and state groups', () => {
  assert.equal(TYPOGRAPHY_TOKEN_CLASS.pageTitle, 'nimi-type--page-title');
  assert.equal(SPACING_TOKEN_VALUE.section, 'var(--nimi-space-section)');
  assert.equal(STROKE_TOKEN_VALUE.strong, 'var(--nimi-border-strong)');
  assert.equal(STATE_TONE_CLASS.selected, 'nimi-state--selected');
});

test('sidebar primitives expose the shared desktop sidebar family classes', () => {
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
          trailingAffordance="badge"
        />
      </SidebarSection>
      <SidebarResizeHandle ariaLabel="resize" onMouseDown={() => {}} />
    </SidebarShell>,
  );

  assert.match(markup, /nimi-sidebar-shell/u);
  assert.match(markup, /nimi-sidebar-header/u);
  assert.match(markup, /nimi-sidebar-search/u);
  assert.match(markup, /nimi-sidebar-section/u);
  assert.match(markup, /nimi-sidebar-item/u);
  assert.match(markup, /nimi-sidebar-item--nav-row/u);
  assert.match(markup, /nimi-sidebar-affordance--badge/u);
  assert.match(markup, /nimi-sidebar-resize-handle/u);
  assert.match(markup, /data-testid="sidebar-shell"/u);
});

test('sidebar design tokens export family, item kind, and affordance groups', () => {
  assert.equal(SIDEBAR_FAMILY_CLASS['nimi-sidebar-v1'], 'nimi-sidebar-shell');
  assert.equal(SIDEBAR_ITEM_KIND_CLASS['entity-row'], 'nimi-sidebar-item--entity-row');
  assert.equal(SIDEBAR_AFFORDANCE_CLASS.chevron, 'nimi-sidebar-affordance--chevron');
});
